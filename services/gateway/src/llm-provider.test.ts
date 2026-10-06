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
  callLLM,
  LLMNotConfiguredError,
  LLMUnavailableError,
  ProviderCallError,
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
    await expect(callLLM({ ...REQ, usage: { reserve, settle } })).rejects.toThrow('Fixture budget denied');
    expect(fetch).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });
  it('does not repeat a successful vendor call after settlement fails', async () => {
    process.env.ANTHROPIC_API_KEY = 'fixture';
    process.env.OPENAI_API_KEY = 'fixture';
    const fetch = stubFetchAnthropicOk();
    const reserve = vi.fn(async () => 'reservation');
    const settle = vi.fn(async () => { throw new Error('Fixture ledger outage'); });
    await expect(callLLM({ ...REQ, provider: 'anthropic', usage: { reserve, settle } })).rejects.toThrow('Fixture ledger outage');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(1);
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
