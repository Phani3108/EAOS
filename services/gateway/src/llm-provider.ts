/**
 * LLM Provider — Multi-provider abstraction for AgentOS
 *
 * Supports: Anthropic Claude, OpenAI GPT, Google Gemini, Azure OpenAI, Ollama (local).
 * The gateway reads credentials from environment variables. The frontend selects
 * which provider + model to use per execution. Callers use `callLLM()` which
 * routes to the correct provider automatically.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LLMProviderId = 'anthropic' | 'openai' | 'azure-openai' | 'gemini' | 'ollama';

export interface LLMRequest {
  provider?: LLMProviderId;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  provider: LLMProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  cost: number; // estimated USD
}

export interface ProviderConfig {
  id: LLMProviderId;
  name: string;
  available: boolean;
  defaultModel: string;
  models: string[];
}

// ---------------------------------------------------------------------------
// Errors
//
// `callLLM` throws. It used to swallow every provider failure and return
// placeholder prose, which made an outage indistinguishable from a successful
// run: the step was marked completed, KPIs and the After-Action Report ingested
// the placeholder, and the circuit breaker in model-router.ts could never open
// because its catch block was unreachable.
// ---------------------------------------------------------------------------

/** A single provider attempt failed. Carries the HTTP status when there was one. */
export class ProviderCallError extends Error {
  readonly name = 'ProviderCallError';
  constructor(
    readonly providerId: LLMProviderId,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** One attempt in a fallback chain, as reported to the caller. */
export interface ProviderAttempt {
  id: LLMProviderId;
  status?: number;
  message: string;
}

/**
 * No provider has credentials configured. This is an operator error, not a
 * runtime failure — it is not retryable and must not be billed.
 */
export class LLMNotConfiguredError extends Error {
  readonly name = 'LLMNotConfiguredError';
  constructor() {
    super(
      'No LLM provider configured. Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, ' +
        'GEMINI_API_KEY, AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_KEY, or OLLAMA_BASE_URL.',
    );
  }
}

/**
 * Every configured provider was attempted and every one failed. Retryable.
 * `providersTried` is what the run surface renders and what the operator needs.
 */
export class LLMUnavailableError extends Error {
  readonly name = 'LLMUnavailableError';
  constructor(readonly providersTried: ProviderAttempt[]) {
    super(
      `All ${providersTried.length} configured LLM provider(s) failed: ` +
        providersTried
          .map(a => `${a.id}${a.status ? ` (${a.status})` : ''}: ${a.message}`)
          .join('; '),
    );
  }
}

// ---------------------------------------------------------------------------
// Cost estimates per 1M tokens (input / output)
// ---------------------------------------------------------------------------

const COST_TABLE: Record<string, { input: number; output: number }> = {
  // Anthropic Claude 4.x (current)
  'claude-opus-4-7': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
  // Anthropic Claude 3.x (legacy)
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-opus-20240229': { input: 15, output: 75 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'o1': { input: 15, output: 60 },
  'o1-mini': { input: 3, output: 12 },
  // Gemini
  'gemini-1.5-pro': { input: 1.25, output: 5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  // Ollama / local — free
  'llama3.2': { input: 0, output: 0 },
  'mistral': { input: 0, output: 0 },
  'phi-3': { input: 0, output: 0 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_TABLE[model] ?? { input: 2, output: 10 };
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

async function callAnthropic(req: LLMRequest): Promise<LLMResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ProviderCallError('anthropic', 'ANTHROPIC_API_KEY not set');

  const model = req.model || 'claude-sonnet-4-6';
  const start = Date.now();

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new ProviderCallError('anthropic', `Anthropic API error ${res.status}: ${errText}`, res.status);
  }

  const data = (await res.json()) as {
    content: Array<{ text: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };

  const inputTokens = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;

  return {
    content: data.content?.[0]?.text ?? '',
    provider: 'anthropic',
    model,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - start,
    cost: estimateCost(model, inputTokens, outputTokens),
  };
}

async function callOpenAI(req: LLMRequest): Promise<LLMResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ProviderCallError('openai', 'OPENAI_API_KEY not set');

  const model = req.model || 'gpt-4o';
  const start = Date.now();

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new ProviderCallError('openai', `OpenAI API error ${res.status}: ${errText}`, res.status);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;

  return {
    content: data.choices?.[0]?.message?.content ?? '',
    provider: 'openai',
    model,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - start,
    cost: estimateCost(model, inputTokens, outputTokens),
  };
}

async function callAzureOpenAI(req: LLMRequest): Promise<LLMResponse> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_KEY;
  const deployment = req.model || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';
  if (!endpoint || !apiKey) throw new ProviderCallError('azure-openai', 'AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_KEY required');

  const start = Date.now();
  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-02-15-preview`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new ProviderCallError('azure-openai', `Azure OpenAI error ${res.status}: ${errText}`, res.status);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;

  return {
    content: data.choices?.[0]?.message?.content ?? '',
    provider: 'azure-openai',
    model: deployment,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - start,
    cost: estimateCost('gpt-4o', inputTokens, outputTokens),
  };
}

async function callGemini(req: LLMRequest): Promise<LLMResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderCallError('gemini', 'GEMINI_API_KEY not set');

  const model = req.model || 'gemini-1.5-pro';
  const start = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.systemPrompt }] },
      contents: [{ parts: [{ text: req.userPrompt }] }],
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.7,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new ProviderCallError('gemini', `Gemini API error ${res.status}: ${errText}`, res.status);
  }

  const data = (await res.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  };

  const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

  return {
    content: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
    provider: 'gemini',
    model,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - start,
    cost: estimateCost(model, inputTokens, outputTokens),
  };
}

async function callOllama(req: LLMRequest): Promise<LLMResponse> {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = req.model || process.env.OLLAMA_MODEL || 'llama3.2';
  const start = Date.now();

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.userPrompt },
      ],
      options: {
        num_predict: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.7,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new ProviderCallError('ollama', `Ollama error ${res.status}: ${errText}`, res.status);
  }

  const data = (await res.json()) as {
    message: { content: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };

  return {
    content: data.message?.content ?? '',
    provider: 'ollama',
    model,
    inputTokens: data.prompt_eval_count ?? 0,
    outputTokens: data.eval_count ?? 0,
    latencyMs: Date.now() - start,
    cost: 0, // local = free
  };
}

// ---------------------------------------------------------------------------
// Provider availability detection
// ---------------------------------------------------------------------------

export function getAvailableProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [
    {
      id: 'anthropic',
      name: 'Anthropic Claude',
      available: !!process.env.ANTHROPIC_API_KEY,
      defaultModel: 'claude-sonnet-4-6',
      models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-3-5-sonnet-20241022'],
    },
    {
      id: 'openai',
      name: 'OpenAI GPT',
      available: !!process.env.OPENAI_API_KEY,
      defaultModel: 'gpt-4o',
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini'],
    },
    {
      id: 'azure-openai',
      name: 'Azure OpenAI',
      available: !!(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_KEY),
      defaultModel: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
      models: [process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o'],
    },
    {
      id: 'gemini',
      name: 'Google Gemini',
      available: !!process.env.GEMINI_API_KEY,
      defaultModel: 'gemini-1.5-pro',
      models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
    },
    {
      id: 'ollama',
      name: 'Ollama (Local)',
      available: !!process.env.OLLAMA_BASE_URL || false, // requires explicit opt-in
      defaultModel: process.env.OLLAMA_MODEL || 'llama3.2',
      models: ['llama3.2', 'mistral', 'phi-3'],
    },
  ];
  return providers;
}

/** Returns the first provider with credentials configured */
export function getDefaultProvider(): LLMProviderId {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.AZURE_OPENAI_ENDPOINT) return 'azure-openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OLLAMA_BASE_URL) return 'ollama';
  return 'anthropic'; // fallback
}

// ---------------------------------------------------------------------------
// Key presence check — used by server.ts to auto-default simulate mode
// ---------------------------------------------------------------------------

/** Returns true when at least one LLM provider has credentials configured. */
export function hasAnyLLMKey(): boolean {
  return !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    (process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_KEY) ||
    process.env.OLLAMA_BASE_URL
  );
}

// ---------------------------------------------------------------------------
// Unified call — the single entry point for all LLM calls in the gateway
// ---------------------------------------------------------------------------

const PROVIDER_DISPATCH: Record<LLMProviderId, (req: LLMRequest) => Promise<LLMResponse>> = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  'azure-openai': callAzureOpenAI,
  gemini: callGemini,
  ollama: callOllama,
};

/**
 * Unified LLM call with automatic fallback chain.
 *
 * 1. Try the requested provider (or default)
 * 2. If it fails, try each remaining available provider in priority order
 * 3. If ALL providers fail, THROW
 *
 * This function throws. It does not return placeholder content under any
 * circumstances. Callers that want simulated output must ask for it explicitly
 * via the `simulate` flag on the execution request, which routes to
 * `generateSandboxOutput()` in persona-api.ts and stamps the result as
 * synthetic — so a simulated run is never mistaken for a measured one.
 *
 * @throws {LLMNotConfiguredError} no provider has credentials — not retryable
 * @throws {LLMUnavailableError}   every configured provider failed — retryable
 */
export async function callLLM(req: LLMRequest): Promise<LLMResponse> {
  const providers = getAvailableProviders();
  const availableIds = providers.filter(p => p.available).map(p => p.id);

  if (availableIds.length === 0) {
    throw new LLMNotConfiguredError();
  }

  // Build ordered fallback chain: requested provider first, then others by priority
  const requestedId = req.provider ?? getDefaultProvider();

  // The requested provider only leads the chain if it is actually available;
  // otherwise it would be skipped mid-loop and never reported as an attempt.
  const chain = availableIds.includes(requestedId)
    ? [requestedId, ...availableIds.filter(id => id !== requestedId)]
    : availableIds;

  const attempts: ProviderAttempt[] = [];

  for (const providerId of chain) {
    const handler = PROVIDER_DISPATCH[providerId];
    if (!handler) continue;

    try {
      // For fallback providers, clear the model so they use their default
      const callReq = providerId === requestedId ? req : { ...req, provider: providerId, model: undefined };
      return await handler(callReq);
    } catch (err) {
      const status = err instanceof ProviderCallError ? err.status : undefined;
      const message = (err as Error).message;
      attempts.push({ id: providerId, status, message });
      const isLast = providerId === chain[chain.length - 1];
      console.warn(
        `[llm-provider] ${providerId} failed: ${message}${isLast ? '' : ' — trying next provider'}`,
      );
    }
  }

  // Every configured provider failed. Throwing here is what allows
  // recordCircuitFailure() in model-router.ts to fire, the step to be marked
  // failed instead of completed, and the run to be excluded from KPIs.
  console.error(`[llm-provider] All ${attempts.length} provider(s) failed.`);
  throw new LLMUnavailableError(attempts);
}
