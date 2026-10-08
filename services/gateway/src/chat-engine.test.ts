/**
 * File-store chat and the run-mode rule.
 *
 * On the file store a chat reply called the provider directly, with no budget
 * and no run-mode check: a public demo visitor spent the deployment's key on
 * every message, and a keyless gateway answered every message with an error.
 * A message the rule simulates now takes the canonical execution path (a
 * labelled simulated run); only a live reply calls the provider directly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from './auth.js';

const mocks = vi.hoisted(() => ({ callLLM: vi.fn(), submit: vi.fn(async () => 'exec-fixture') }));
vi.mock('./llm-provider.js', async importOriginal => ({ ...(await importOriginal<typeof import('./llm-provider.js')>()), callLLM: mocks.callLLM }));
vi.mock('./ws.js', () => ({ broadcastEvent: vi.fn() }));

const ENV_KEYS = ['EAOS_DEMO_MODE', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_KEY', 'OLLAMA_BASE_URL'] as const;
const saved: Record<string, string | undefined> = {};
const tenantId = 'tenant-fixture';
const principal = (id: string): AuthUser => ({ id, tenantId, name: 'Fixture', email: 'fixture@example.invalid', role: 'user', teams: [], personaScopes: ['*'] });

beforeEach(() => {
  for (const key of ENV_KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  vi.clearAllMocks();
  mocks.callLLM.mockResolvedValue({ content: 'A live reply.', provider: 'anthropic', model: 'claude-sonnet-4-6', inputTokens: 1, outputTokens: 1, latencyMs: 1, cost: 0 });
});
afterEach(() => { for (const key of ENV_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

async function send(user: AuthUser) {
  const store = await import('./chat-store.js');
  const engine = await import('./chat-engine.js');
  store.configureChatRepository(undefined);
  engine.configureChatExecutionAdapter(mocks.submit);
  const session = await store.createSession({ userId: user.id, tenantId, persona: 'engineering' });
  return engine.postMessage({ sessionId: session.sessionId, userId: user.id, tenantId, content: 'Summarise the fixture', principal: user });
}

describe('file-store chat follows the run-mode rule', () => {
  it('never calls the provider for a public demo visitor', async () => {
    process.env.EAOS_DEMO_MODE = 'public';
    process.env.ANTHROPIC_API_KEY = 'fixture';
    const result = await send(principal('demo:9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'));
    expect(mocks.callLLM).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ replyPath: 'skill', executionId: 'exec-fixture' });
  });
  it('simulates on a keyless gateway instead of replying with a provider error', async () => {
    const result = await send(principal('user-fixture'));
    expect(mocks.callLLM).not.toHaveBeenCalled();
    expect(result).toMatchObject({ replyPath: 'skill', executionId: 'exec-fixture' });
  });
  it('still replies live for a member when a provider is configured', async () => {
    process.env.ANTHROPIC_API_KEY = 'fixture';
    const result = await send(principal('user-fixture'));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.callLLM).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ replyPath: 'chat', agentMessage: { content: 'A live reply.' } });
  });
});
