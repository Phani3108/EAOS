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

/**
 * Ceiling on a single provider attempt. Exported because callers that answer
 * synchronously (review, chat) and the web tier's gateway proxy derive their
 * own deadlines from it: a proxy that gives up first turns a slow but healthy
 * call into an opaque 500 while the gateway keeps paying for it.
 */
export const PROVIDER_CALL_TIMEOUT_MS = 60_000;

export interface LLMRequest {
  signal?: AbortSignal;
  /**
   * Durable budget ledger. Each provider attempt reserves before dispatch; a
   * success settles its observed cost, and an attempt that provably produced
   * no billable completion is released (see `attemptWasNotBilled`).
   */
  usage?: {
    reserve: (request: LLMRequest) => Promise<string>;
    settle: (id: string, response: LLMResponse) => Promise<void>;
    release: (id: string) => Promise<void>;
  };
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

interface ModelPrice { input: number; output: number }

const COST_TABLE: Record<string, ModelPrice & { provider: LLMProviderId }> = {
  // Anthropic Claude 4.x (current)
  'claude-opus-4-7': { provider: 'anthropic', input: 15, output: 75 },
  'claude-sonnet-4-6': { provider: 'anthropic', input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { provider: 'anthropic', input: 0.8, output: 4 },
  // Anthropic Claude 3.x (legacy)
  'claude-3-5-sonnet-20241022': { provider: 'anthropic', input: 3, output: 15 },
  'claude-3-opus-20240229': { provider: 'anthropic', input: 15, output: 75 },
  'claude-3-haiku-20240307': { provider: 'anthropic', input: 0.25, output: 1.25 },
  // OpenAI
  'gpt-4o': { provider: 'openai', input: 2.5, output: 10 },
  'gpt-4o-mini': { provider: 'openai', input: 0.15, output: 0.6 },
  'gpt-4-turbo': { provider: 'openai', input: 10, output: 30 },
  'o1': { provider: 'openai', input: 15, output: 60 },
  'o1-mini': { provider: 'openai', input: 3, output: 12 },
  // Gemini
  'gemini-1.5-pro': { provider: 'gemini', input: 1.25, output: 5 },
  'gemini-1.5-flash': { provider: 'gemini', input: 0.075, output: 0.3 },
  'gemini-2.0-flash': { provider: 'gemini', input: 0.1, output: 0.4 },
  // Ollama / local — free
  'llama3.2': { provider: 'ollama', input: 0, output: 0 },
  'mistral': { provider: 'ollama', input: 0, output: 0 },
  'phi-3': { provider: 'ollama', input: 0, output: 0 },
};

/**
 * The rate a request is billed at, by the same rule its recorded cost uses:
 * Ollama is local and free (callOllama records 0), and every Azure deployment
 * is costed at gpt-4o rates (callAzureOpenAI) — so an operator's own deployment
 * name or OLLAMA_MODEL is priced even though it is not a table key. Other
 * providers are priced by model; `undefined` means no known price.
 */
function priceOf(provider: LLMProviderId | undefined, model: string | undefined): ModelPrice | undefined {
  if (provider === 'ollama') return { input: 0, output: 0 };
  if (provider === 'azure-openai') return COST_TABLE['gpt-4o'];
  return model ? COST_TABLE[model] : undefined;
}

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
    signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(PROVIDER_CALL_TIMEOUT_MS)]) : AbortSignal.timeout(PROVIDER_CALL_TIMEOUT_MS),
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
    signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(PROVIDER_CALL_TIMEOUT_MS)]) : AbortSignal.timeout(PROVIDER_CALL_TIMEOUT_MS),
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
    signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(PROVIDER_CALL_TIMEOUT_MS)]) : AbortSignal.timeout(PROVIDER_CALL_TIMEOUT_MS),
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
    signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(PROVIDER_CALL_TIMEOUT_MS)]) : AbortSignal.timeout(PROVIDER_CALL_TIMEOUT_MS),
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
    signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(PROVIDER_CALL_TIMEOUT_MS)]) : AbortSignal.timeout(PROVIDER_CALL_TIMEOUT_MS),
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
// Priced models — what a live run may request
// ---------------------------------------------------------------------------

export interface PricedModel {
  id: string;
  provider: LLMProviderId;
  /** USD per 1M tokens: the rate budget is reserved at and cost is recorded at. */
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  /** The provider's model when a run names none. */
  providerDefault: boolean;
  /** The provider has credentials on this gateway. */
  available: boolean;
}

/**
 * Every model a live run may name: each provider's priced models, plus the
 * operator's Azure deployment and Ollama model (priced by provider, see
 * `priceOf`). A live run reserves budget at its model's price before dispatch,
 * so a model without one could never run — it is refused at submission
 * (`admitModel`) instead of failing at its first step.
 */
export function listPricedModels(): PricedModel[] {
  return getAvailableProviders().flatMap(config => {
    // Azure routes to a named deployment, and only the configured one is known to exist.
    const ids = config.id === 'azure-openai'
      ? [config.defaultModel]
      : [...new Set([...Object.keys(COST_TABLE).filter(id => COST_TABLE[id]!.provider === config.id), config.defaultModel])];
    return ids.flatMap(id => {
      const price = priceOf(config.id, id);
      return price ? [{ id, provider: config.id, inputUsdPerMTok: price.input, outputUsdPerMTok: price.output, providerDefault: id === config.defaultModel, available: config.available }] : [];
    });
  });
}

/** A live run named a model this gateway has no price for. 400: the request is fixable. */
export class UnpricedModelError extends Error {
  readonly name = 'UnpricedModelError';
  readonly statusCode = 400;
  constructor(readonly model: string, readonly provider: LLMProviderId | undefined, readonly allowedModels: string[]) {
    super(
      `Model "${model}"${provider ? ` is not a priced ${provider} model` : ' has no known price'}, so a live run cannot reserve budget for it. ` +
        `Choose one of: ${allowedModels.join(', ')} — or omit modelId to use the provider default.`,
    );
  }
}

/**
 * Admit a client-chosen model for a live run. With no provider named, the run
 * goes to the provider that prices the model (preferring a configured one), so
 * `gpt-4o` is not sent to whichever provider happens to be the default.
 *
 * @throws {UnpricedModelError} the model is unknown, or not one of `provider`'s
 */
export function admitModel(provider: LLMProviderId | undefined, model: string | undefined): { provider?: LLMProviderId; model?: string } {
  if (!model) return { provider, model };
  const candidates = listPricedModels().filter(entry => !provider || entry.provider === provider);
  const matches = candidates.filter(entry => entry.id === model);
  const match = matches.find(entry => entry.available) ?? matches[0];
  if (!match) throw new UnpricedModelError(model, provider, [...new Set(candidates.map(entry => entry.id))]);
  return { provider: match.provider, model };
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
 * Upper bound, in micro-USD, of what one provider attempt can cost: every input
 * byte counted as a token plus the full output allowance. Reserved before
 * dispatch, so a tenant budget is never overrun by requests in flight.
 *
 * Throws only for a model with no known price — never invented. Submission
 * refuses such models (`admitModel`), so reaching this means a run admitted
 * before that check existed.
 */
export function estimateRequestMicros(request: LLMRequest): number {
  const config = getAvailableProviders().find(provider => provider.id === request.provider);
  const model = request.model ?? config?.defaultModel;
  const price = priceOf(request.provider, model);
  if (!price) throw new Error(`Model "${model ?? 'unspecified'}" has no known price, so usage cannot be reserved for it`);
  const inputBound = Buffer.byteLength(request.systemPrompt + request.userPrompt, 'utf8') + 256;
  return Math.ceil(inputBound * price.input + (request.maxTokens ?? 4096) * price.output);
}

/**
 * Gateway timeouts: the provider stopped answering, not refused — the request
 * may still have completed, and been billed, upstream.
 */
const UNCERTAIN_HTTP_STATUSES = new Set([504, 524]);
/** Connection-setup failures: the request never reached the provider. */
const NEVER_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

/**
 * True when a failed attempt cannot have produced a billable completion, so its
 * reservation can go back to the budget: the provider answered with an error
 * status, the request was refused before dispatch (a missing credential), or the
 * connection was never established. Everything else — an abort or reset after
 * the request was sent, or a 2xx body that could not be read — may have been
 * billed, and keeps its reservation rather than inventing zero cost.
 */
function attemptWasNotBilled(err: unknown): boolean {
  if (err instanceof ProviderCallError) return err.status === undefined || !UNCERTAIN_HTTP_STATUSES.has(err.status);
  const code = (err as { cause?: { code?: unknown } } | undefined)?.cause?.code;
  return typeof code === 'string' && NEVER_SENT_CODES.has(code);
}

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
  req.signal?.throwIfAborted();
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

    // For fallback providers, clear the model so they use their default
    const callReq = providerId === requestedId ? { ...req, provider: providerId } : { ...req, provider: providerId, model: undefined };
    const reservation = await req.usage?.reserve(callReq);
    let response: LLMResponse;
    try {
      response = await handler(callReq);
    } catch (err) {
      req.signal?.throwIfAborted();
      const status = err instanceof ProviderCallError ? err.status : undefined;
      const message = (err as Error).message;
      attempts.push({ id: providerId, status, message });
      // Before the next provider reserves its own share: a fallback chain that
      // kept every refused attempt's reservation would drain the budget with
      // calls that cost nothing — permanently, since reservations do not expire.
      if (reservation !== undefined && attemptWasNotBilled(err)) await req.usage!.release(reservation);
      const isLast = providerId === chain[chain.length - 1];
      console.warn(
        `[llm-provider] ${providerId} failed: ${message}${isLast ? '' : ' — trying next provider'}`,
      );
      continue;
    }
    if (reservation !== undefined) await req.usage!.settle(reservation, response);
    return response;
  }

  // Every configured provider failed. Throwing here is what allows
  // recordCircuitFailure() in model-router.ts to fire, the step to be marked
  // failed instead of completed, and the run to be excluded from KPIs.
  console.error(`[llm-provider] All ${attempts.length} provider(s) failed.`);
  throw new LLMUnavailableError(attempts);
}
