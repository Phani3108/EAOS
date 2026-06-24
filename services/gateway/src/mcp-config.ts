/**
 * MCP server config loader — reads mcp.servers.json from the repo root, substitutes
 * ${ENV_VAR} references, and filters out any server whose `enabledWhenEnv` gate var is
 * unset. The gate is the simulation-fallback hook: with no env configured, zero servers
 * are returned and the gateway runs exactly as before.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServerConfig } from './mcp-client.js';

interface RawServer extends McpServerConfig {
  enabledWhenEnv?: string;
}

/** Locate mcp.servers.json at the repo root regardless of cwd (gateway runs from services/gateway). */
function configPath(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.EAOS_MCP_CONFIG) return process.env.EAOS_MCP_CONFIG;
  try {
    const repoCfg = resolve(dirname(fileURLToPath(import.meta.url)), '../../../mcp.servers.json');
    if (existsSync(repoCfg)) return repoCfg;
  } catch { /* fall through */ }
  return resolve(process.cwd(), 'mcp.servers.json');
}

function substituteEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, k) => process.env[k] ?? '');
}

function deepSub(v: unknown): unknown {
  if (typeof v === 'string') return substituteEnv(v);
  if (Array.isArray(v)) return v.map(deepSub);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = deepSub(val);
    return out;
  }
  return v;
}

export function loadMcpServerConfigs(path?: string): McpServerConfig[] {
  const file = configPath(path);
  if (!existsSync(file)) return [];

  let raw: { servers?: RawServer[] };
  try {
    raw = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    console.warn('[mcp] failed to parse mcp.servers.json:', (err as Error).message);
    return [];
  }

  const enabled: McpServerConfig[] = [];
  for (const s of raw.servers ?? []) {
    // Gate: a server whose enabledWhenEnv var is unset is skipped entirely.
    if (s.enabledWhenEnv && !process.env[s.enabledWhenEnv]) continue;
    const sub = deepSub(s) as RawServer;
    const { enabledWhenEnv: _drop, ...cfg } = sub;
    enabled.push(cfg);
  }
  return enabled;
}
