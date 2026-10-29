/**
 * Run admission decides run mode and model for every entry point.
 *
 * Each case below was a live-run leak or a run that could only fail:
 *   - chat hardcoded simulate=false, so a public demo visitor's every message
 *     was a live, billable run, and a keyless gateway failed every message;
 *   - registry execute/preview trusted the client's `simulate`;
 *   - entrypoint schemas defaulted a missing `simulate` to live;
 *   - a client-chosen model with no price was admitted, then failed at the
 *     usage reservation before any provider was tried.
 * The runtime now decides in preparePersonaExecution, so these assert on the
 * admitted run, not on what a route passed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from './auth.js';
import type { ChatSession } from './chat-store.js';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), emit: vi.fn(async () => {}) }));
vi.mock('./task-queue.js', () => ({ enqueue: mocks.enqueue }));
vi.mock('./event-bus.js', () => ({ eventBus: { emit: mocks.emit } }));
vi.mock('./agent-memory.js', () => ({ buildAgentMemoryContext: () => '', extractAndStoreMemory: vi.fn(), initAgentMemory: async () => {} }));

const ENV_KEYS = ['EAOS_DEMO_MODE', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_KEY', 'AZURE_OPENAI_DEPLOYMENT', 'OLLAMA_BASE_URL', 'OLLAMA_MODEL'] as const;
const saved: Record<string, string | undefined> = {};

const tenantId = 'tenant-fixture';
const principal = (id: string, role: AuthUser['role'] = 'user'): AuthUser => ({ id, tenantId, name: 'Fixture', email: 'fixture@example.invalid', role, teams: [], personaScopes: ['*'] });
const visitor = principal('demo:0d7b4a8e-7d3c-4f0e-8a8a-0c1d2e3f4a5b');
const member = principal('user-fixture');
const operator = principal('operator-fixture', 'admin');
const inputs = { code_or_module: 'fixture module' };

let api: typeof import('./persona-api.js');
let eng007: import('./definition-registry.js').CompiledDefinition;
beforeEach(async () => {
  for (const key of ENV_KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  vi.resetModules(); vi.clearAllMocks();
  mocks.enqueue.mockImplementation(value => value);
  api = await import('./persona-api.js');
  eng007 = (await import('./definition-registry.js')).getCompiledDefinition('eng-007', 'engineering')!;
});
afterEach(() => { for (const key of ENV_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

describe('preparePersonaExecution decides run mode from the run owner', () => {
  it('simulates a public demo visitor even when the caller asks for live', () => {
    process.env.EAOS_DEMO_MODE = 'public';
    process.env.ANTHROPIC_API_KEY = 'fixture';
    const { exec, payload } = api.preparePersonaExecution(tenantId, 'engineering', eng007, inputs, visitor.id, false);
    expect(exec.mode).toBe('simulation');
    expect(payload.simulate).toBe(true);
  });
  it('treats a missing choice as live only when a provider is configured', () => {
    expect(api.preparePersonaExecution(tenantId, 'engineering', eng007, inputs, member.id).exec.mode).toBe('simulation');
    process.env.ANTHROPIC_API_KEY = 'fixture';
    expect(api.preparePersonaExecution(tenantId, 'engineering', eng007, inputs, member.id).exec.mode).toBe('live');
  });
  it('keeps an explicit choice from everyone else', () => {
    process.env.ANTHROPIC_API_KEY = 'fixture';
    expect(api.preparePersonaExecution(tenantId, 'engineering', eng007, inputs, member.id, true).exec.mode).toBe('simulation');
    expect(api.preparePersonaExecution(tenantId, 'engineering', eng007, inputs, member.id, false).exec.mode).toBe('live');
  });
  it('carries the decided mode into the queued work, not the requested one', async () => {
    process.env.EAOS_DEMO_MODE = 'public';
    process.env.ANTHROPIC_API_KEY = 'fixture';
    const run = await api.createPersonaExecution(tenantId, 'engineering', eng007, inputs, visitor.id, false);
    expect(run.mode).toBe('simulation');
    expect(mocks.enqueue.mock.calls.at(-1)![0].payload.simulate).toBe(true);
  });
});

describe('a live run must name a priced model', () => {
  it('refuses an unpriced model at submission with a 400 that lists the alternatives', () => {
    process.env.ANTHROPIC_API_KEY = 'fixture';
    // The persona hubs' old default — never a COST_TABLE key, so every live run failed at its first step.
    let refused: unknown;
    try { api.preparePersonaExecution(tenantId, 'engineering', eng007, inputs, member.id, false, undefined, 'anthropic', 'claude-sonnet-4-6-20251001'); } catch (error) { refused = error; }
    expect(refused).toMatchObject({ statusCode: 400 });
    expect((refused as Error).message).toMatch(/claude-sonnet-4-6\b.*Choose one of|Choose one of.*claude-sonnet-4-6\b/);
  });
  it('does not reject a model that a simulation never calls', () => {
    process.env.ANTHROPIC_API_KEY = 'fixture';
    const { exec } = api.preparePersonaExecution(tenantId, 'engineering', eng007, inputs, member.id, true, undefined, 'anthropic', 'claude-sonnet-4-6-20251001');
    expect(exec.mode).toBe('simulation');
  });
  it('routes a model named without a provider to the provider that prices it', () => {
    process.env.ANTHROPIC_API_KEY = 'fixture';
    process.env.OPENAI_API_KEY = 'fixture';
    const { exec, payload } = api.preparePersonaExecution(tenantId, 'engineering', eng007, inputs, member.id, false, undefined, undefined, 'gpt-4o-mini');
    expect(payload).toMatchObject({ provider: 'openai', modelId: 'gpt-4o-mini' });
    expect(exec.provider).toBe('openai');
  });
});

describe('chat submits through the run-mode decision', () => {
  const session = (owner: AuthUser): ChatSession => ({ sessionId: 'chat-fixture', userId: owner.id, tenantId, title: 'Fixture', persona: 'engineering', pinnedContextIds: [], createdAt: '', updatedAt: '' });
  const submit = async (owner: AuthUser) => {
    const { submitChatExecution } = await import('./orchestration-adapters.js');
    const id = await submitChatExecution(owner, session(owner), 'Summarise the fixture', 'user: Summarise the fixture', `msg-${Math.random()}`);
    return api.getPersonaExecution(id, tenantId)!;
  };
  it('never spends the deployment key on a public demo visitor', async () => {
    process.env.EAOS_DEMO_MODE = 'public';
    process.env.ANTHROPIC_API_KEY = 'fixture';
    expect((await submit(visitor)).mode).toBe('simulation');
  });
  it('simulates on a keyless gateway instead of queuing a run that can only fail', async () => {
    expect((await submit(member)).mode).toBe('simulation');
  });
  it('stays live for a member when a provider is configured', async () => {
    process.env.ANTHROPIC_API_KEY = 'fixture';
    expect((await submit(member)).mode).toBe('live');
  });
});

describe('registry packages run through the run-mode decision', () => {
  async function registry(user: AuthUser, action: 'execute' | 'preview', body: Record<string, unknown>) {
    const { platformRequest } = await import('./platform-api.js');
    const { compileDefinition } = await import('./definition-registry.js');
    const definition = compileDefinition(eng007);
    type Admitted = { snapshot: { mode: string }; payload: { simulate: boolean } };
    const submitted: Admitted[] = [];
    const version = async () => ({ packageId: 'pkg-fixture', hash: definition.definitionHash, definition, revision: 1 });
    const repository = {
      getActiveVersion: version,
      candidateVersion: version,
      submitPublished: async (_principal: unknown, _runs: unknown, _id: unknown, _revision: unknown, snapshot: Admitted['snapshot'], _definition: unknown, payload: Admitted['payload']) => { submitted.push({ snapshot, payload }); return snapshot; },
      submitCandidate: async (_principal: unknown, _runs: unknown, _id: unknown, snapshot: Admitted['snapshot'], _definition: unknown, payload: Admitted['payload']) => { submitted.push({ snapshot, payload }); return snapshot; },
    };
    const url = new URL(`http://gateway.invalid/api/registry/packages/pkg-fixture/${action}`);
    const result = await platformRequest(repository as never, {} as never, user, url, 'POST', async () => ({ inputs, requestKey: 'fixture-key', ...(action === 'preview' ? { hash: definition.definitionHash } : {}), ...body }), () => {});
    expect(result.status).toBe(201);
    return submitted[0]!;
  }
  it('simulates a public demo visitor who asks a published package for a live run', async () => {
    process.env.EAOS_DEMO_MODE = 'public';
    process.env.ANTHROPIC_API_KEY = 'fixture';
    const run = await registry(visitor, 'execute', { simulate: false });
    expect(run.snapshot.mode).toBe('simulation');
    expect(run.payload.simulate).toBe(true);
  });
  it('accepts a request with no run-mode choice and decides it', async () => {
    expect((await registry(member, 'execute', {})).snapshot.mode).toBe('simulation');
    process.env.ANTHROPIC_API_KEY = 'fixture';
    expect((await registry(member, 'execute', {})).snapshot.mode).toBe('live');
    expect((await registry(operator, 'preview', {})).snapshot.mode).toBe('live');
  });
});

describe('entrypoints treat a missing simulate as no choice', () => {
  async function launch(path: string, body: Record<string, unknown>) {
    const { entrypointRequest } = await import('./entrypoint-api.js');
    return entrypointRequest({} as never, operator, new URL(`http://gateway.invalid${path}`), 'POST', async () => body);
  }
  it('simulates a swarm launched from the UI on a keyless gateway', async () => {
    const result = await launch('/api/swarms/launch', { type: 'product_launch', mission: 'Fixture launch' });
    expect(result.status).toBe(201);
    expect((result.data as { mode: string }).mode).toBe('simulation');
  });
  it('runs it live once a provider is configured', async () => {
    process.env.ANTHROPIC_API_KEY = 'fixture';
    const result = await launch('/api/swarms/launch', { type: 'product_launch', mission: 'Fixture launch' });
    expect((result.data as { mode: string }).mode).toBe('live');
  });
  it('refuses a plan-less goal the runtime would simulate instead of admitting a run that cannot plan', async () => {
    const result = await launch('/api/orchestrator/goal', { description: 'Fixture goal without a plan' });
    expect(result.status).toBe(422);
    expect((result.data as { error: string }).error).toMatch(/no LLM provider configured/);
  });
});
