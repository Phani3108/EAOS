/**
 * EAOS Skill Security Scan — governance gate that screens a skill for prompt-injection,
 * data-exfiltration, tool-poisoning and similar risks before it is registered or imported.
 *
 * When a scanner is configured (SKILLSPECTOR_CMD), the skill body is written to a temp
 * SKILL.md and scanned as a subprocess; its JSON report is normalized into an EAOS
 * ScanResult. When NO scanner is configured the gate is fail-open (returns null → caller
 * treats it as a pass), matching EAOS's simulation-fallback philosophy.
 *
 * Provenance of the default scan engine: NVIDIA/SkillSpector (Apache-2.0). See third_party/NOTICE.
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type ScanSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ScanFinding {
  severity: ScanSeverity;
  category: string;
  detail: string;
}

export interface ScanResult {
  passed: boolean;
  riskScore: number; // 0..100
  findings: ScanFinding[];
  engine: string;
}

/** True when an external skill scanner is configured. */
export function isSkillScanConfigured(): boolean {
  return !!process.env.SKILLSPECTOR_CMD;
}

function failOpen(): boolean {
  return (process.env.SKILLSPECTOR_FAIL_OPEN ?? 'true') !== 'false';
}

/**
 * Scan a skill's content. Returns null when no scanner is configured (gate skipped),
 * so callers do: `const scan = await scanSkill(...); if (scan && !scan.passed) reject`.
 */
export async function scanSkill(skill: { name: string; persona?: string; body: string }): Promise<ScanResult | null> {
  const cmd = process.env.SKILLSPECTOR_CMD;
  if (!cmd) return null; // not configured → gate is skipped (fail-open)

  const dir = mkdtempSync(join(tmpdir(), 'eaos-skillscan-'));
  const file = join(dir, 'SKILL.md');
  writeFileSync(file, `---\nname: ${skill.name}\npersona: ${skill.persona ?? 'general'}\n---\n${skill.body}`);

  try {
    const out = await run(cmd, ['scan', file, '--format', 'json', '--no-llm']);
    const parsed = JSON.parse(out) as Record<string, any>;
    const rawFindings = parsed.findings ?? parsed.filtered_findings ?? [];
    const findings: ScanFinding[] = rawFindings.map((f: any) => ({
      severity: String(f.severity ?? 'low').toLowerCase() as ScanSeverity,
      category: String(f.category ?? f.rule ?? f.type ?? 'unknown'),
      detail: String(f.message ?? f.detail ?? f.description ?? ''),
    }));
    const riskScore = Number(parsed.risk_score ?? parsed.riskScore ?? 0);
    const passed = riskScore < 50 && !findings.some(f => f.severity === 'critical' || f.severity === 'high');
    return { passed, riskScore, findings, engine: 'skillspector' };
  } catch (err) {
    // Scanner failed to run / parse — respect the fail-open setting.
    if (failOpen()) return { passed: true, riskScore: 0, findings: [], engine: 'skillspector(unavailable)' };
    return {
      passed: false,
      riskScore: 100,
      findings: [{ severity: 'high', category: 'scanner_error', detail: (err as Error).message }],
      engine: 'skillspector(error)',
    };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { timeout: 30_000 });
    let out = '';
    let err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    // exit 0 = clean, exit 1 = findings present (still valid JSON output); anything else = error
    p.on('close', code => (code === 0 || code === 1 ? resolve(out) : reject(new Error(err || `scanner exited ${code}`))));
  });
}
