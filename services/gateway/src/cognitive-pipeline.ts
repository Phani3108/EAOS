/**
 * Cognitive Pipeline — Goal decomposition, reasoning, reflection, and grounding
 *
 * Extracted from services/cognitive-engine and wired through the gateway's
 * multi-provider LLM system. Provides the full cognitive pipeline:
 * decompose → plan → reason → execute → reflect → ground
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { callLLM as callLLMProvider, type LLMProviderId } from './llm-provider.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CognitiveRequest {
  id: string;
  goal: string;
  context: Record<string, unknown>;
  options?: {
    skipReflection?: boolean;
    skipGrounding?: boolean;
    provider?: LLMProviderId;
    modelId?: string;
  };
}

export type CognitiveStageName = 'decompose' | 'plan' | 'reason' | 'execute' | 'reflect' | 'ground';

export interface StageResult {
  stage: CognitiveStageName;
  durationMs: number;
  result: unknown;
}

export interface CognitiveResult {
  requestId: string;
  output: string;
  /**
   * Undefined when the producing stage was skipped or returned an unreadable
   * verdict. Previously defaulted to `1.0` / `true`, so a pipeline configured to
   * skip grounding still reported perfect grounding.
   */
  confidence?: number;
  grounded?: boolean;
  groundingScore?: number;
  stages: StageResult[];
  totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Results store
// ---------------------------------------------------------------------------

const results = new Map<string, CognitiveResult>();

// ---------------------------------------------------------------------------
// LLM helper — routes through multi-provider system
// ---------------------------------------------------------------------------

async function llmCall(system: string, user: string, provider?: LLMProviderId, modelId?: string): Promise<string> {
  const response = await callLLMProvider({ provider, model: modelId, systemPrompt: system, userPrompt: user, maxTokens: 4096 });
  return response.content;
}

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Pipeline Stages
// ---------------------------------------------------------------------------

export async function decompose(goal: string, provider?: LLMProviderId, modelId?: string): Promise<{ subtasks: string[] }> {
  const raw = await llmCall(
    'You are a task decomposition engine. Break goals into concrete subtasks. Return JSON: {"subtasks": ["...","..."]}',
    `Decompose this goal into subtasks:\n\n${goal}`,
    provider, modelId,
  );
  return parseJSON(raw, { subtasks: [goal] });
}

export async function plan(goal: string, subtasks: string[], provider?: LLMProviderId, modelId?: string): Promise<{ plan: string }> {
  const raw = await llmCall(
    'You are a strategic planner. Create an execution plan for the given subtasks. Return JSON: {"plan": "..."}',
    `Goal: ${goal}\nSubtasks:\n${subtasks.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    provider, modelId,
  );
  return parseJSON(raw, { plan: raw });
}

export async function reason(goal: string, planText: string, provider?: LLMProviderId, modelId?: string): Promise<{ reasoning: string; confidence?: number; parseFailed?: boolean }> {
  const raw = await llmCall(
    'You are a reasoning engine. Analyze the plan, identify risks and optimizations. Return JSON: {"reasoning": "...", "confidence": 0.0-1.0}',
    `Goal: ${goal}\nPlan: ${planText}`,
    provider, modelId,
  );
  // No invented confidence: 0.7 was ours, not the model's.
  return parseJSON(raw, { reasoning: raw, parseFailed: true });
}

export async function reflect(output: string, goal: string, provider?: LLMProviderId, modelId?: string): Promise<{ score?: number; feedback: string; parseFailed?: boolean }> {
  const raw = await llmCall(
    'You are a quality reflection engine. Evaluate the output quality. Return JSON: {"score": 0.0-1.0, "feedback": "..."}',
    `Goal: ${goal}\n\nOutput to evaluate:\n${output.slice(0, 2000)}`,
    provider, modelId,
  );
  // A made-up quality score is worse than none — callers cannot tell them apart.
  return parseJSON(raw, { feedback: raw, parseFailed: true });
}

export async function groundCheck(output: string, context: Record<string, unknown>, provider?: LLMProviderId, modelId?: string): Promise<{ grounded?: boolean; score?: number; parseFailed?: boolean }> {
  const raw = await llmCall(
    'You are a hallucination checker. Evaluate if the output is grounded in the provided context. Return JSON: {"grounded": true/false, "score": 0.0-1.0}',
    `Context: ${JSON.stringify(context).slice(0, 1500)}\n\nOutput to check:\n${output.slice(0, 2000)}`,
    provider, modelId,
  );
  // A hallucination checker that fails open is worse than no checker. On an
  // unreadable verdict the answer is "unknown", never "grounded".
  return parseJSON(raw, { parseFailed: true });
}

// ---------------------------------------------------------------------------
// Full Pipeline
// ---------------------------------------------------------------------------

export async function processCognitivePipeline(request: CognitiveRequest): Promise<CognitiveResult> {
  const startTime = Date.now();
  const stages: StageResult[] = [];
  const { provider, modelId, skipReflection, skipGrounding } = request.options ?? {};

  // 1. Decompose
  const t1 = Date.now();
  const { subtasks } = await decompose(request.goal, provider, modelId);
  stages.push({ stage: 'decompose', durationMs: Date.now() - t1, result: { subtasks } });

  // 2. Plan
  const t2 = Date.now();
  const { plan: planText } = await plan(request.goal, subtasks, provider, modelId);
  stages.push({ stage: 'plan', durationMs: Date.now() - t2, result: { plan: planText } });

  // 3. Reason
  const t3 = Date.now();
  const { reasoning, confidence } = await reason(request.goal, planText, provider, modelId);
  stages.push({ stage: 'reason', durationMs: Date.now() - t3, result: { reasoning, confidence } });

  // 4. Execute
  const t4 = Date.now();
  const output = await llmCall(
    `You are an enterprise AI agent. Use the plan and reasoning to produce a high-quality result.\n\nPlan: ${planText}\nReasoning: ${reasoning}`,
    `Execute this goal and produce the final output:\n\n${request.goal}`,
    provider, modelId,
  );
  stages.push({ stage: 'execute', durationMs: Date.now() - t4, result: { output: output.slice(0, 500) } });

  // 5. Reflect
  let qualityScore = confidence;
  if (!skipReflection) {
    const t5 = Date.now();
    const { score, feedback } = await reflect(output, request.goal, provider, modelId);
    qualityScore = score;
    stages.push({ stage: 'reflect', durationMs: Date.now() - t5, result: { score, feedback } });
  }

  // 6. Ground — undefined until the check runs and returns a readable verdict.
  let grounded: boolean | undefined;
  let groundingScore: number | undefined;
  if (!skipGrounding) {
    const t6 = Date.now();
    const check = await groundCheck(output, request.context, provider, modelId);
    grounded = check.grounded;
    groundingScore = check.score;
    stages.push({ stage: 'ground', durationMs: Date.now() - t6, result: check });
  }

  const result: CognitiveResult = {
    requestId: request.id,
    output,
    confidence: qualityScore,
    grounded,
    groundingScore,
    stages,
    totalDurationMs: Date.now() - startTime,
  };

  results.set(request.id, result);
  return result;
}

/** Retrieve a previously completed cognitive result */
export function getCognitiveResult(requestId: string): CognitiveResult | undefined {
  return results.get(requestId);
}

/** Get trace (stages) for a cognitive result */
export function getCognitiveTrace(requestId: string): StageResult[] | undefined {
  return results.get(requestId)?.stages;
}
