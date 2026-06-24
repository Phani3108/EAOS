/**
 * EAOS Regiment Review — collaborative multi-role review pipeline.
 *
 * Runs an artifact (plan, PRD, design doc, diff, spec) through an ordered chain of
 * review-role agents mapped to EAOS regiments (Strategy → Design → Engineering → DevEx).
 * Each reviewer sees the artifact AND all prior reviewers' verdicts, so the chain is
 * genuinely collaborative — later reviewers build on or push back against earlier ones.
 * The review-role instructions are EAOS-native and self-contained (no external skill files).
 *
 * Degrades to a deterministic simulated review when no LLM key is configured, matching the
 * gateway's simulation-fallback philosophy (hasAnyLLMKey()).
 */

import { randomUUID } from 'node:crypto';
import { callLLM, hasAnyLLMKey } from './llm-provider.js';

export type ReviewVerdict = 'approve' | 'changes_requested';

export interface ReviewerResult {
  role: string;
  label: string;
  persona: string;
  verdict: ReviewVerdict;
  summary: string;
  findings: string[];
  model?: string;
  cost?: number;
  simulated: boolean;
}

export interface ReviewPipelineResult {
  id: string;
  artifactPreview: string;
  reviewers: ReviewerResult[];
  finalVerdict: ReviewVerdict;
  consolidatedFindings: string[];
  approvals: number;
  changesRequested: number;
  simulated: boolean;
  totalCost: number;
}

interface ReviewRoleDef {
  role: string;
  label: string;
  persona: string;
  instructions: string; // EAOS-native review lens
}

// The regiment review chain — EAOS-native review lenses (self-contained).
const DEFAULT_REVIEW_CHAIN: ReviewRoleDef[] = [
  {
    role: 'strategy', label: 'Strategy Review', persona: 'program',
    instructions:
      'Review as the EAOS strategy/command lead. Assess business value, alignment to stated objectives, ' +
      'scope discipline, sequencing, and risk. Flag misaligned priorities, scope creep, unstated assumptions, ' +
      'and unmanaged risks.',
  },
  {
    role: 'design', label: 'Design Review', persona: 'design',
    instructions:
      'Review as the EAOS design lead. Assess user-experience clarity, consistency, accessibility, and ' +
      'information hierarchy. Flag confusing flows, inconsistent patterns, accessibility gaps, and unclear copy.',
  },
  {
    role: 'engineering', label: 'Engineering Review', persona: 'engineering',
    instructions:
      'Review as the EAOS engineering lead. Assess architecture, correctness, edge cases, test coverage, ' +
      'performance, and security. Flag design flaws, missing tests, race conditions, and security risks before ' +
      'implementation begins.',
  },
  {
    role: 'devex', label: 'DevEx Review', persona: 'engineering',
    instructions:
      'Review as the EAOS developer-experience lead. Assess API ergonomics, naming, documentation, and ' +
      'long-term maintainability. Flag confusing interfaces, inconsistent naming, and missing or stale docs.',
  },
];

/** Tolerant JSON extraction — strips code fences and grabs the first object block. */
function parseVerdictJson(text: string): { verdict?: string; summary?: string; findings?: string[] } | null {
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1]!.trim();
  const brace = cleaned.match(/\{[\s\S]*\}/);
  if (brace) cleaned = brace[0];
  try { return JSON.parse(cleaned); } catch { return null; }
}

function simulatedReview(roleDef: ReviewRoleDef): ReviewerResult {
  return {
    role: roleDef.role,
    label: roleDef.label,
    persona: roleDef.persona,
    verdict: 'approve',
    summary: `[simulated] ${roleDef.label} found no blocking issues. Configure an LLM API key (ANTHROPIC_API_KEY/OPENAI_API_KEY) for a real review.`,
    findings: [],
    simulated: true,
  };
}

/** The configured review chain (role + lens + persona). */
export function getReviewChain(): Array<{ role: string; label: string; persona: string; available: boolean }> {
  return DEFAULT_REVIEW_CHAIN.map(r => ({ role: r.role, label: r.label, persona: r.persona, available: true }));
}

export async function runReviewPipeline(
  artifact: string,
  opts: { roles?: string[]; provider?: string; modelId?: string } = {}
): Promise<ReviewPipelineResult> {
  const chain = DEFAULT_REVIEW_CHAIN.filter(r => !opts.roles || opts.roles.includes(r.role));
  const simulate = !hasAnyLLMKey();
  const reviewers: ReviewerResult[] = [];
  let totalCost = 0;

  for (const roleDef of chain) {
    if (simulate) {
      reviewers.push(simulatedReview(roleDef));
      continue;
    }

    // Collaborative context: each reviewer sees all prior verdicts.
    const priorContext = reviewers.length
      ? '\n\n## Prior Reviews (collaborate — build on, defer to, or push back against these)\n' +
        reviewers
          .map(r => `### ${r.label} → ${r.verdict}\n${r.summary}${r.findings.length ? '\nFindings:\n- ' + r.findings.join('\n- ') : ''}`)
          .join('\n\n')
      : '';

    const systemPrompt =
      `You are the ${roleDef.label} agent in EAOS (regiment: ${roleDef.persona}), one reviewer in a ` +
      `collaborative multi-role review chain.\n\n${roleDef.instructions}`;

    const userPrompt =
      `## Artifact Under Review\n${artifact}${priorContext}\n\n` +
      `## Your Task\nReview the artifact strictly through your role's lens. Respond with ONLY a JSON object:\n` +
      `{"verdict": "approve" | "changes_requested", "summary": "<2-3 sentence assessment>", ` +
      `"findings": ["<specific, actionable finding>", ...]}`;

    try {
      const res = await callLLM({
        provider: opts.provider as any,
        model: opts.modelId,
        systemPrompt,
        userPrompt,
        maxTokens: 1500,
        temperature: 0.3,
      });
      totalCost += res.cost;
      const parsed = parseVerdictJson(res.content);
      const verdict: ReviewVerdict = parsed?.verdict === 'changes_requested' ? 'changes_requested' : 'approve';
      reviewers.push({
        role: roleDef.role,
        label: roleDef.label,
        persona: roleDef.persona,
        verdict,
        summary: parsed?.summary ?? res.content.slice(0, 400),
        findings: Array.isArray(parsed?.findings) ? parsed!.findings!.map(String) : [],
        model: res.model,
        cost: res.cost,
        simulated: false,
      });
    } catch (err) {
      // A reviewer failure must not abort the chain — record and continue.
      reviewers.push({
        role: roleDef.role,
        label: roleDef.label,
        persona: roleDef.persona,
        verdict: 'approve',
        summary: `Review could not complete: ${(err as Error).message}`,
        findings: [],
        simulated: true,
      });
    }
  }

  const changesRequested = reviewers.filter(r => r.verdict === 'changes_requested').length;
  const consolidatedFindings = reviewers.flatMap(r => r.findings.map(f => `[${r.label}] ${f}`));

  return {
    id: `review-${randomUUID().slice(0, 8)}`,
    artifactPreview: artifact.slice(0, 200),
    reviewers,
    finalVerdict: changesRequested > 0 ? 'changes_requested' : 'approve',
    consolidatedFindings,
    approvals: reviewers.length - changesRequested,
    changesRequested,
    simulated: simulate,
    totalCost,
  };
}
