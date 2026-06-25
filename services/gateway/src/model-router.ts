/**
 * Model Router — Intelligent LLM model selection based on task complexity,
 * cost budgets, and quality requirements.
 *
 * Routes tasks to the optimal model:
 * - Simple tasks → Haiku/Flash (fast, cheap)
 * - Standard tasks → Sonnet/GPT-4o (balanced)
 * - Complex tasks → Opus/o1 (highest quality)
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { callLLM, type LLMRequest, type LLMResponse, type LLMProviderId, getDefaultProvider, hasAnyLLMKey } from './llm-provider.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type TaskComplexity = 'simple' | 'moderate' | 'complex' | 'critical';

export interface ModelRouterConfig {
  /** Maximum cost per execution in USD */
  maxCostPerExec: number;
  /** Maximum cost per hour in USD */
  maxCostPerHour: number;
  /** Preferred provider (overrides auto-routing) */
  preferredProvider?: LLMProviderId;
  /** Force a specific model (bypasses router) */
  forceModel?: string;
  /** Whether to use cheaper models for retries */
  cheapRetries: boolean;
}

export interface RoutingDecision {
  provider: LLMProviderId;
  model: string;
  reason: string;
  estimatedCostUsd: number;
  complexity: TaskComplexity;
}

/** Thrown when the hourly cost cap is hit and a real provider call would exceed budget. */
export class BudgetExceededError extends Error {
  readonly hourlySpend: number;
  readonly maxCostPerHour: number;
  constructor(hourlySpend: number, maxCostPerHour: number) {
    super(`Hourly budget exceeded: ${hourlySpend.toFixed(2)}/${maxCostPerHour} USD — call blocked`);
    this.name = 'BudgetExceededError';
    this.hourlySpend = hourlySpend;
    this.maxCostPerHour = maxCostPerHour;
  }
}

/** Thrown when a provider's circuit breaker is open and a real call is short-circuited. */
export class CircuitOpenError extends Error {
  readonly provider: LLMProviderId;
  constructor(provider: LLMProviderId) {
    super(`Circuit open for provider "${provider}" — call blocked (failing fast)`);
    this.name = 'CircuitOpenError';
    this.provider = provider;
  }
}

// ═══════════════════════════════════════════════════════════════
// Model Tiers
// ═══════════════════════════════════════════════════════════════

const MODEL_TIERS: Record<TaskComplexity, { anthropic: string; openai: string; gemini: string }> = {
  simple:   { anthropic: 'claude-3-haiku-20240307',      openai: 'gpt-4o-mini', gemini: 'gemini-2.0-flash' },
  moderate: { anthropic: 'claude-sonnet-4-6-20251001',   openai: 'gpt-4o',      gemini: 'gemini-1.5-pro'  },
  complex:  { anthropic: 'claude-sonnet-4-6-20251001',   openai: 'gpt-4o',      gemini: 'gemini-1.5-pro'  },
  critical: { anthropic: 'claude-3-opus-20240229',       openai: 'o1',          gemini: 'gemini-1.5-pro'  },
};

// Complexity indicators in prompts/tasks
const COMPLEXITY_SIGNALS: Record<TaskComplexity, string[]> = {
  simple: ['summarize', 'format', 'convert', 'list', 'extract', 'parse', 'classify', 'translate'],
  moderate: ['analyze', 'compare', 'review', 'generate', 'draft', 'create', 'explain', 'evaluate'],
  complex: ['architect', 'design', 'strategy', 'comprehensive', 'multi-step', 'synthesize', 'research', 'investigate'],
  critical: ['incident', 'security', 'compliance', 'legal', 'financial', 'executive', 'board', 'audit'],
};

// ═══════════════════════════════════════════════════════════════
// Complexity Detection
// ═══════════════════════════════════════════════════════════════

export function detectComplexity(prompt: string, skillComplexity?: string): TaskComplexity {
  // If skill has explicit complexity, use it
  if (skillComplexity === 'simple') return 'simple';
  if (skillComplexity === 'complex') return 'complex';

  const lower = prompt.toLowerCase();

  // Check for critical signals first
  for (const signal of COMPLEXITY_SIGNALS.critical) {
    if (lower.includes(signal)) return 'critical';
  }
  for (const signal of COMPLEXITY_SIGNALS.complex) {
    if (lower.includes(signal)) return 'complex';
  }
  for (const signal of COMPLEXITY_SIGNALS.simple) {
    if (lower.includes(signal)) return 'simple';
  }

  // Default to moderate
  return 'moderate';
}

// ═══════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: ModelRouterConfig = {
  maxCostPerExec: 1.0,
  maxCostPerHour: 50.0,
  cheapRetries: true,
};

// Hourly cost tracking
let hourlySpend = 0;
let currentHourStart = Date.now();

function resetHourlyCostIfNeeded(): void {
  const now = Date.now();
  if (now - currentHourStart > 3600_000) {
    hourlySpend = 0;
    currentHourStart = now;
  }
}

/** Get the routing decision for a task */
export function routeModel(
  prompt: string,
  config: Partial<ModelRouterConfig> = {},
  skillComplexity?: string,
): RoutingDecision {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  resetHourlyCostIfNeeded();

  // If force model is set, bypass routing
  if (cfg.forceModel) {
    const provider = cfg.preferredProvider || getDefaultProvider();
    return {
      provider,
      model: cfg.forceModel,
      reason: `Forced model: ${cfg.forceModel}`,
      estimatedCostUsd: 0,
      complexity: 'moderate',
    };
  }

  const complexity = detectComplexity(prompt, skillComplexity);
  const provider = cfg.preferredProvider || getDefaultProvider();
  const tier = MODEL_TIERS[complexity];
  const model = tier[provider as keyof typeof tier] || tier.anthropic;

  // Cost budget enforcement — downgrade if near limit
  let finalModel = model;
  let reason = `${complexity} task → ${model}`;

  if (hourlySpend > cfg.maxCostPerHour * 0.8) {
    // Near hourly budget — force cheap model
    const cheapTier = MODEL_TIERS.simple;
    finalModel = cheapTier[provider as keyof typeof cheapTier] || cheapTier.anthropic;
    reason = `Budget pressure (${hourlySpend.toFixed(2)}/${cfg.maxCostPerHour} hourly) → downgraded to ${finalModel}`;
  }

  return {
    provider,
    model: finalModel,
    reason,
    estimatedCostUsd: 0, // filled after execution
    complexity,
  };
}

/** Call LLM through the router with automatic model selection */
export async function routedLLMCall(
  systemPrompt: string,
  userPrompt: string,
  config: Partial<ModelRouterConfig> = {},
  skillComplexity?: string,
): Promise<LLMResponse & { routing: RoutingDecision }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const routing = routeModel(userPrompt, config, skillComplexity);

  // Whether this call will actually hit a real provider. In simulation mode
  // (no LLM key) callLLM returns deterministic sandbox output at zero cost and
  // never makes a network request, so the budget cap and circuit breaker are
  // inert — dev/demo behaviour is unchanged.
  const realCall = hasAnyLLMKey();

  if (realCall) {
    // (2) Hard hourly budget cap — block real spend once the cap is reached.
    // The softer 80% downgrade already happened inside routeModel().
    resetHourlyCostIfNeeded();
    if (hourlySpend >= cfg.maxCostPerHour) {
      throw new BudgetExceededError(hourlySpend, cfg.maxCostPerHour);
    }

    // (1) Circuit breaker — fail fast if this provider's circuit is open.
    // Keyed by provider, consistent with getAllCircuitStates().
    if (isCircuitOpen(routing.provider)) {
      throw new CircuitOpenError(routing.provider);
    }
  }

  const callArgs: LLMRequest = {
    provider: routing.provider,
    model: routing.model,
    systemPrompt,
    userPrompt,
    maxTokens: routing.complexity === 'simple' ? 2048 : routing.complexity === 'critical' ? 8192 : 4096,
    temperature: routing.complexity === 'critical' ? 0.3 : 0.7,
  };

  let response: LLMResponse;
  if (realCall) {
    // Wrap the real provider call so the circuit breaker observes outcomes.
    try {
      response = await callLLM(callArgs);
    } catch (err) {
      recordCircuitFailure(routing.provider);
      throw err;
    }
    recordCircuitSuccess(routing.provider);
  } else {
    // Simulation mode: no breaker, no real failures, no real spend.
    response = await callLLM(callArgs);
  }

  // Track cost
  hourlySpend += response.cost;
  routing.estimatedCostUsd = response.cost;

  return { ...response, routing };
}

// ═══════════════════════════════════════════════════════════════
// Cost Metering
// ═══════════════════════════════════════════════════════════════

export interface CostMeter {
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCalls: number;
  costByProvider: Record<string, number>;
  costByModel: Record<string, number>;
  costByPersona: Record<string, number>;
  hourlyCostUsd: number;
  hourlyBudgetUsd: number;
  budgetUtilization: number;
}

const costLog: { timestamp: string; provider: string; model: string; persona: string; cost: number; tokensIn: number; tokensOut: number }[] = [];

export function recordCostEntry(provider: string, model: string, persona: string, cost: number, tokensIn: number, tokensOut: number): void {
  costLog.push({ timestamp: new Date().toISOString(), provider, model, persona, cost, tokensIn, tokensOut });
  // Keep last 10K entries
  if (costLog.length > 10000) costLog.splice(0, costLog.length - 10000);
}

export function getCostMeter(config: Partial<ModelRouterConfig> = {}): CostMeter {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  resetHourlyCostIfNeeded();

  const costByProvider: Record<string, number> = {};
  const costByModel: Record<string, number> = {};
  const costByPersona: Record<string, number> = {};
  let totalCostUsd = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  for (const entry of costLog) {
    totalCostUsd += entry.cost;
    totalTokensIn += entry.tokensIn;
    totalTokensOut += entry.tokensOut;
    costByProvider[entry.provider] = (costByProvider[entry.provider] || 0) + entry.cost;
    costByModel[entry.model] = (costByModel[entry.model] || 0) + entry.cost;
    costByPersona[entry.persona] = (costByPersona[entry.persona] || 0) + entry.cost;
  }

  return {
    totalCostUsd,
    totalTokensIn,
    totalTokensOut,
    totalCalls: costLog.length,
    costByProvider,
    costByModel,
    costByPersona,
    hourlyCostUsd: hourlySpend,
    hourlyBudgetUsd: cfg.maxCostPerHour,
    budgetUtilization: cfg.maxCostPerHour > 0 ? (hourlySpend / cfg.maxCostPerHour) * 100 : 0,
  };
}

export function getCostHistory(limit = 100): typeof costLog {
  return costLog.slice(-limit);
}

// ═══════════════════════════════════════════════════════════════
// Rate Limiter
// ═══════════════════════════════════════════════════════════════

const rateLimitWindows = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, maxPerMinute: number): { allowed: boolean; remaining: number; resetInMs: number } {
  const now = Date.now();
  const window = rateLimitWindows.get(key);

  if (!window || now > window.resetAt) {
    rateLimitWindows.set(key, { count: 1, resetAt: now + 60_000 });
    // Also attempt Redis sliding window (async, non-blocking)
    _redisRateLimit(key, maxPerMinute).catch(() => {});
    return { allowed: true, remaining: maxPerMinute - 1, resetInMs: 60_000 };
  }

  if (window.count >= maxPerMinute) {
    return { allowed: false, remaining: 0, resetInMs: window.resetAt - now };
  }

  window.count++;
  _redisRateLimit(key, maxPerMinute).catch(() => {});
  return { allowed: true, remaining: maxPerMinute - window.count, resetInMs: window.resetAt - now };
}

async function _redisRateLimit(key: string, maxPerMinute: number): Promise<void> {
  try {
    const { getRedisSync } = await import('./redis-client.js');
    const redis = getRedisSync();
    if (!redis) return;
    const windowKey = `rl:${key}:${Math.floor(Date.now() / 60_000)}`;
    await redis.zadd(windowKey, Date.now(), `${Date.now()}-${Math.random()}`);
    await redis.expire(windowKey, 120);
  } catch { /* Redis unavailable */ }
}

// ═══════════════════════════════════════════════════════════════
// Circuit Breaker
// ═══════════════════════════════════════════════════════════════

interface CircuitState {
  status: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailure: number;
  successesSinceHalfOpen: number;
}

const circuits = new Map<string, CircuitState>();

const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_TIMEOUT_MS = 30_000;
const CIRCUIT_HALF_OPEN_SUCCESSES = 2;

export function getCircuitState(key: string): CircuitState {
  return circuits.get(key) || { status: 'closed', failures: 0, lastFailure: 0, successesSinceHalfOpen: 0 };
}

export function recordCircuitSuccess(key: string): void {
  const state = getCircuitState(key);
  if (state.status === 'half-open') {
    state.successesSinceHalfOpen++;
    if (state.successesSinceHalfOpen >= CIRCUIT_HALF_OPEN_SUCCESSES) {
      state.status = 'closed';
      state.failures = 0;
    }
  } else {
    state.failures = Math.max(0, state.failures - 1);
  }
  circuits.set(key, state);
}

export function recordCircuitFailure(key: string): void {
  const state = getCircuitState(key);
  state.failures++;
  state.lastFailure = Date.now();
  if (state.failures >= CIRCUIT_THRESHOLD) {
    state.status = 'open';
  }
  circuits.set(key, state);
}

export function isCircuitOpen(key: string): boolean {
  const state = getCircuitState(key);
  if (state.status === 'closed') return false;
  if (state.status === 'open') {
    // Check if timeout has elapsed — transition to half-open
    if (Date.now() - state.lastFailure > CIRCUIT_TIMEOUT_MS) {
      state.status = 'half-open';
      state.successesSinceHalfOpen = 0;
      circuits.set(key, state);
      return false; // Allow one request through
    }
    return true;
  }
  return false; // half-open allows requests
}

export function getAllCircuitStates(): Record<string, CircuitState> {
  const result: Record<string, CircuitState> = {};
  circuits.forEach((state, key) => { result[key] = state; });
  return result;
}
