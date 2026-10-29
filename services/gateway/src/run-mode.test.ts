/**
 * run-mode — the one rule that decides whether a run may call a live model.
 *
 * Asserted here because every admission path now depends on it: a regression
 * would let public demo visitors spend the deployment's LLM budget, or make a
 * keyless gateway accept runs that can only fail.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSimulationOnly, resolveSimulate } from './run-mode.js';

const ENV_KEYS = ['EAOS_DEMO_MODE', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_KEY', 'OLLAMA_BASE_URL'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const key of ENV_KEYS) { saved[key] = process.env[key]; delete process.env[key]; } });
afterEach(() => { for (const key of ENV_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

const VISITOR = 'demo:5f0c8a52-6a39-4d8e-9a43-1f2b3c4d5e6f';

describe('public demo visitors are always simulated', () => {
  it.each(['public', 'local', 'off'])('ignores an explicit live request under EAOS_DEMO_MODE=%s', mode => {
    process.env.EAOS_DEMO_MODE = mode;
    process.env.ANTHROPIC_API_KEY = 'fixture';
    // Sessions outlive a mode switch: a visitor minted under `public` keeps a
    // valid session after the operator turns the demo off.
    expect(isSimulationOnly(VISITOR)).toBe(true);
    expect(resolveSimulate(VISITOR, false)).toBe(true);
    expect(resolveSimulate(VISITOR)).toBe(true);
  });
});

describe('the local developer principal', () => {
  it('may run live on its own machine under EAOS_DEMO_MODE=local', () => {
    process.env.EAOS_DEMO_MODE = 'local';
    process.env.ANTHROPIC_API_KEY = 'fixture';
    expect(isSimulationOnly('demo:local')).toBe(false);
    expect(resolveSimulate('demo:local')).toBe(false);
    expect(resolveSimulate('demo:local', true)).toBe(true);
  });
  it.each(['public', 'off', undefined])('is simulated under EAOS_DEMO_MODE=%s', mode => {
    if (mode) process.env.EAOS_DEMO_MODE = mode;
    process.env.ANTHROPIC_API_KEY = 'fixture';
    expect(resolveSimulate('demo:local', false)).toBe(true);
  });
});

describe('everyone else', () => {
  it('gets their explicit choice', () => {
    expect(resolveSimulate('user-1', false)).toBe(false);
    process.env.ANTHROPIC_API_KEY = 'fixture';
    expect(resolveSimulate('user-1', true)).toBe(true);
  });
  it('is simulated with no choice exactly when no LLM provider is configured', () => {
    expect(resolveSimulate('user-1')).toBe(true);
    expect(resolveSimulate('user-1', 'yes')).toBe(true);
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    expect(resolveSimulate('user-1')).toBe(false);
    expect(resolveSimulate(undefined)).toBe(false);
  });
});
