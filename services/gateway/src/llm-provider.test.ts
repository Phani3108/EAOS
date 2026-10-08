/**
 * llm-provider — failure contract
 *
 * This is the first test in the repo, and it exists because of the single most
 * damaging bug in the codebase: `callLLM` never threw. When every provider
 * failed it returned placeholder prose, the step was marked `completed`, and
 * `recordExecution({ success: true })` fired — feeding agent KPIs, the
 * After-Action Report, adaptive routing, and the benchmark corpus with the text
 * "No LLM provider configured".
 *
 * Under usage-based pricing that is not a metrics bug, it is a fraudulent
 * invoice: a billed run that delivered nothing.
 *
 * The contract asserted here:
 *   - no providers configured   → LLMNotConfiguredError
 *   - all configured providers fail → LLMUnavailableError, listing every attempt
 *   - a working provider still returns normally (happy-path regression guard)
 *   - nothing anywhere returns placeholder text
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  admitModel,
  callLLM,
  estimateRequestMicros,
  listPricedModels,
  LLMNotConfiguredError,
  LLMUnavailableError,
  ProviderCallError,
  UnpricedModelError,
  type LLMRequest,
} from './llm-provider.js';

/** Every env var `getAvailableProviders()` reads, so each test starts from zero. */
const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_KEY',
  'AZURE_OPENAI_DEPLOYMENT',
  'GEMINI_API_KEY',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
] as const;

describe('durable usage boundary', () => {
  it('does not call a provider when budget reservation fails', async () => {
    process.env.ANTHROPIC_API_KEY = 'fixture';
    const fetch = stubFetchAnthropicOk();
    const reserve = vi.fn(async () => { throw new Error('Fixture budget denied'); });
    const settle = vi.fn(async () => {});
    const release = vi.fn(async () => {});
    await expect(callLLM({ ...REQ, usage: { reserve, settle, release } })).rejects.toThrow('Fixture budget denied');
    expect(fetch).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });
  it('does not repeat a successful vendor call after settlement fails', async () => {
    process.env.ANTHROPIC_API_KEY = 'fixture';
    process.env.OPENAI_API_KEY = 'fixture';
    const fetch = stubFetchAnthropicOk();
    const reserve = vi.fn(async () => 'reservation');
    const settle = vi.fn(async () => { throw new Error('Fixture ledger outage'); });
    const release = vi.fn(async () => {});
    await expect(callLLM({ ...REQ, provider: 'anthropic', usage: { reserve, settle, release } })).rejects.toThrow('Fixture ledger outage');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });
});

/**
 * Reservations follow what the provider did. Every attempt reserved and only a
 * success settled, so a mistyped key or a 429 storm left reservations that never
 * expire, and the budget ran out with nothing spent.
 */
describe('usage reservations of failed attempts', () => {
  function ledger() {
    const events: string[] = [];
    const usage = {
      reserve: vi.fn(async (request: LLMRequest) => { events.push(`reserve:${request.provider}`); return `r-${request.provider}`; }),
      settle: vi.fn(async (id: string) => { events.push(`settle:${id}`); }),
      release: vi.fn(async (id: string) => { events.push(`release:${id}`); }),
    };
    return { events, usage };
  }
  const openAiOk = () => new Response(JSON.stringify({ choices: [{ message: { content: 'From the fallback provider.' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  it('releases a refused attempt before the fallback provider reserves its own', async () => {
    process.env.ANTHROPIC_API_KEY = 'fixture';
    process.env.OPENAI_API_KEY = 'fixture';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('anthropic') ? new Response('invalid x-api-key', { status: 401 }) : openAiOk()));
    const { events, usage } = ledger();
    const response = await callLLM({ ...REQ, provider: 'anthropic', usage });
    expect(response.provider).toBe('openai');
    expect(events).toEqual(['reserve:anthropic', 'release:r-anthropic', 'reserve:openai', 'settle:r-openai']);
  });

  it('returns every reservation when the whole chain is refused', async () => {
    process.env.ANTHROPIC_API_KEY = 'fixture';
    process.env.OPENAI_API_KEY = 'fixture';
    stubFetchStatus(429, 'rate_limit_error');
    const { usage } = ledger();
    await expect(callLLM({ ...REQ, usage })).rejects.toThrow(LLMUnavailableError);
    expect(usage.release.mock.calls.map(([id]) => id).sort()).toEqual(['r-anthropic', 'r-openai']);
    expect(usage.settle).not.toHaveBeenCalled();
  });

  it('releases when the connection was never established', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }) }); }));
    const { usage } = ledger();
    await expect(callLLM({ ...REQ, usage })).rejects.toThrow(LLMUnavailableError);
    expect(usage.release).toHaveBeenCalledWith('r-ollama');
  });

  it.each([
    ['a connection reset after the request was sent', () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) }); }],
    ['a gateway timeout', () => new Response('upstream timed out', { status: 504 })],
    ['a 2xx body that could not be read', () => new Response('<html>not json</html>', { status: 200 })],
  ])('keeps the reservation after %s: the request may have been billed', async (_case, respond) => {
    process.env.ANTHROPIC_API_KEY = 'fixture';
    vi.stubGlobal('fetch', vi.fn(async () => respond()));
    const { usage } = ledger();
    await expect(callLLM({ ...REQ, usage })).rejects.toThrow(LLMUnavailableError);
    expect(usage.reserve).toHaveBeenCalledTimes(1);
    expect(usage.release).not.toHaveBeenCalled();
  });

  it('keeps the reservation when the run is aborted mid-request', async () => {
    process.env.ANTHROPIC_API_KEY = 'fixture';
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(); throw new DOMException('The operation was aborted', 'AbortError'); }));
    const { usage } = ledger();
    await expect(callLLM({ ...REQ, signal: controller.signal, usage })).rejects.toThrow();
    expect(usage.release).not.toHaveBeenCalled();
  });
});

describe('priced models', () => {
  it('prices an operator Azure deployment and Ollama model by provider, as their cost is recorded', () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://fixture.openai.azure.invalid';
    process.env.AZURE_OPENAI_KEY = 'fixture';
    process.env.AZURE_OPENAI_DEPLOYMENT = 'contoso-gpt4o-prod';
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    process.env.OLLAMA_MODEL = 'qwen2.5-coder';
    // callAzureOpenAI records every deployment's cost at gpt-4o rates; callOllama records 0.
    expect(estimateRequestMicros({ ...REQ, provider: 'azure-openai' })).toBe(estimateRequestMicros({ ...REQ, provider: 'openai', model: 'gpt-4o' }));
    expect(estimateRequestMicros({ ...REQ, provider: 'ollama' })).toBe(0);
    expect(estimateRequestMicros({ ...REQ, provider: 'ollama', model: 'llama3.1' })).toBe(0);
  });

  it('never invents a price for an unknown hosted model', () => {
    expect(() => estimateRequestMicros({ ...REQ, provider: 'anthropic', model: 'claude-sonnet-4-6-20251001' })).toThrow(/no known price/);
  });

  it('lists exactly the models a reservation can price, and admits each of them', () => {
    process.env.AZURE_OPENAI_DEPLOYMENT = 'contoso-gpt4o-prod';
    process.env.OLLAMA_MODEL = 'qwen2.5-coder';
    process.env.ANTHROPIC_API_KEY = 'fixture';
    const models = listPricedModels();
    for (const entry of models) {
      expect(() => estimateRequestMicros({ ...REQ, provider: entry.provider, model: entry.id })).not.toThrow();
      expect(admitModel(entry.provider, entry.id)).toEqual({ provider: entry.provider, model: entry.id });
    }
    expect(models).toContainEqual(expect.objectContaining({ id: 'claude-sonnet-4-6', provider: 'anthropic', providerDefault: true, available: true }));
    expect(models).toContainEqual(expect.objectContaining({ id: 'contoso-gpt4o-prod', provider: 'azure-openai', inputUsdPerMTok: 2.5, available: false }));
    expect(models).toContainEqual(expect.objectContaining({ id: 'qwen2.5-coder', provider: 'ollama', inputUsdPerMTok: 0, outputUsdPerMTok: 0 }));
    // Previously offered by the persona hubs, never priced: refused rather than listed.
    for (const unpriced of ['claude-sonnet-4-6-20251001', 'o3-mini', 'llama3.1', 'azure-gpt-4o']) expect(models.some(entry => entry.id === unpriced)).toBe(false);
  });

  it('refuses an unpriced or mismatched model with a 400 that names the alternatives', () => {
    let refused: unknown;
    try { admitModel('anthropic', 'claude-sonnet-4-6-20251001'); } catch (error) { refused = error; }
    expect(refused).toBeInstanceOf(UnpricedModelError);
    expect(refused).toMatchObject({ statusCode: 400, model: 'claude-sonnet-4-6-20251001', provider: 'anthropic' });
    expect((refused as UnpricedModelError).allowedModels).toContain('claude-sonnet-4-6');
    expect((refused as Error).message).toContain('claude-sonnet-4-6,');
    expect(() => admitModel('ollama', 'gpt-4o')).toThrow(UnpricedModelError);
    expect(() => admitModel(undefined, 'llama3.1')).toThrow(/Choose one of: .*llama3\.2/);
  });

  it('routes a model named without a provider to the configured provider that prices it', () => {
    expect(admitModel(undefined, 'gpt-4o-mini')).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    process.env.AZURE_OPENAI_ENDPOINT = 'https://fixture.openai.azure.invalid';
    process.env.AZURE_OPENAI_KEY = 'fixture';
    expect(admitModel(undefined, 'gpt-4o')).toEqual({ provider: 'azure-openai', model: 'gpt-4o' });
    expect(admitModel('anthropic', undefined)).toEqual({ provider: 'anthropic', model: undefined });
  });
});

const originalEnv: Record<string, string | undefined> = {};

const REQ = {
  systemPrompt: 'You are a test harness.',
  userPrompt: 'Summarise the release notes for v2.',
};

beforeEach(() => {
  for (const key of PROVIDER_ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  vi.restoreAllMocks();
});

afterEach(() => {
  for (const key of PROVIDER_ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  vi.restoreAllMocks();
});

/** Minimal `fetch` stub: every call resolves to the given HTTP status. */
function stubFetchStatus(status: number, body = 'upstream exploded') {
  const spy = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** Minimal `fetch` stub shaped like a successful Anthropic messages response. */
function stubFetchAnthropicOk(text = 'Real model output.') {
  const spy = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          content: [{ text }],
          usage: { input_tokens: 120, output_tokens: 40 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('callLLM — no provider configured', () => {
  it('throws LLMNotConfiguredError instead of returning placeholder prose', async () => {
    const fetchSpy = stubFetchStatus(500);

    await expect(callLLM(REQ)).rejects.toThrow(LLMNotConfiguredError);

    // It must fail before any network attempt — there is nothing to attempt.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('names the env vars an operator needs to set', async () => {
    stubFetchStatus(500);

    await expect(callLLM(REQ)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe('callLLM — all configured providers fail', () => {
  it('throws LLMUnavailableError rather than a fabricated success', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    stubFetchStatus(529, 'overloaded_error');

    await expect(callLLM(REQ)).rejects.toThrow(LLMUnavailableError);
  });

  it('reports every provider it tried, with status and message', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OPENAI_API_KEY = 'sk-oai-test';
    stubFetchStatus(503, 'service unavailable');

    const err = await callLLM(REQ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LLMUnavailableError);
    const tried = (err as LLMUnavailableError).providersTried;

    // Both configured providers must appear — the fallback chain is the whole
    // point, and a single-entry list would mean the chain silently stopped.
    expect(tried.map(t => t.id).sort()).toEqual(['anthropic', 'openai']);
    for (const attempt of tried) {
      expect(attempt.status).toBe(503);
      expect(attempt.message).toBeTruthy();
    }
  });

  it('treats a provider whose key is absent as not attempted', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    stubFetchStatus(500);

    const err = (await callLLM(REQ).catch((e: unknown) => e)) as LLMUnavailableError;

    expect(err.providersTried.map(t => t.id)).toEqual(['anthropic']);
  });
});

describe('callLLM — never emits placeholder content', () => {
  it('has no code path that resolves with sandbox prose', async () => {
    // The old fallbacks were reachable in exactly two ways: zero providers, and
    // all-providers-failed. Both must now reject.
    const cases: Array<() => void> = [
      () => {
        /* zero providers */
      },
      () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      },
    ];

    for (const setup of cases) {
      for (const key of PROVIDER_ENV_KEYS) delete process.env[key];
      setup();
      stubFetchStatus(500);

      const result = await callLLM(REQ).then(
        r => ({ resolved: true as const, r }),
        e => ({ resolved: false as const, e }),
      );

      expect(result.resolved).toBe(false);
      if (result.resolved) {
        // Belt-and-braces: if this ever regresses to resolving, fail loudly on
        // the exact strings the old placeholder emitted.
        expect(result.r.content).not.toMatch(/No LLM provider configured/);
        expect(result.r.model).not.toMatch(/^sandbox/);
      }
    }
  });
});

describe('callLLM — happy path still works', () => {
  it('returns a normal response when a provider succeeds', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    stubFetchAnthropicOk('Release notes: two fixes, one feature.');

    const res = await callLLM(REQ);

    expect(res.content).toBe('Release notes: two fixes, one feature.');
    expect(res.provider).toBe('anthropic');
    expect(res.model).toBe('claude-sonnet-4-6');
    expect(res.inputTokens).toBe(120);
    expect(res.outputTokens).toBe(40);
    expect(res.cost).toBeGreaterThan(0);
  });

  it('falls back to the next provider when the first fails', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OPENAI_API_KEY = 'sk-oai-test';

    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        if (call === 1) return new Response('overloaded', { status: 529 });
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'From the fallback provider.' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );

    const res = await callLLM(REQ);

    expect(res.provider).toBe('openai');
    expect(res.content).toBe('From the fallback provider.');
  });
});

describe('ProviderCallError', () => {
  it('carries the HTTP status so the fallback chain can report it', () => {
    const err = new ProviderCallError('anthropic', 'Anthropic API error 529', 529);

    expect(err).toBeInstanceOf(Error);
    expect(err.providerId).toBe('anthropic');
    expect(err.status).toBe(529);
  });
});
