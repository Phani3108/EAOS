import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';

const base = 'http://localhost:32198';
const children: ChildProcess[] = [];
let dataDir: string;
const setupToken = 'm0-browser-fixture-setup-token';
const signingSecret = 'm0-browser-fixture-signing-key-not-for-production';
function fixtureToken(id: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'HS256' })}.${encode({ sub: id, tenantId: 'browser-fixture', role: 'user', personaScopes: ['*'], iss: 'eaos', aud: 'eaos-api', exp: Math.floor(Date.now() / 1000) + 300 })}`;
  return `${input}.${createHmac('sha256', signingSecret).update(input).digest('base64url')}`;
}
test.setTimeout(60_000);

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'eaos-browser-fixture-'));
  const common = { PATH: process.env.PATH, NODE_ENV: 'production', SEED_DEMO: 'false' };
  const gateway = spawn(process.execPath, [resolve('services/gateway/dist/server.js')], {
    env: { ...common, PORT: '32199', JWT_SECRET: signingSecret, EAOS_SETUP_TOKEN: setupToken, EAOS_TENANT_ID: 'browser-fixture', DATA_DIR: dataDir, CORS_ALLOWED_ORIGINS: base, FRONTEND_URL: base, REDIS_URL: 'redis://127.0.0.1:1', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1', EAOS_MCP_CONFIG: '/dev/null/mcp.json' },
    stdio: 'ignore',
  });
  children.push(gateway);
  cpSync(resolve('apps/web/.next/static'), resolve('apps/web/.next/standalone/apps/web/.next/static'), { recursive: true });
  const web = spawn(process.execPath, [resolve('apps/web/.next/standalone/apps/web/server.js')], {
    env: { ...common, PORT: '32198', HOSTNAME: '127.0.0.1', NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'ignore',
  });
  children.push(web);
  for (let i = 0; i < 100; i++) {
    if (children.some(child => child.exitCode !== null)) throw new Error('Fixture server exited; check that test ports are unused and artifacts are built');
    try {
      const response = await fetch(`${base}/_/gateway/api/live`, { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).pid === gateway.pid) return;
    } catch {}
    await delay(100);
  }
  throw new Error('Browser fixture gateway proxy did not become ready');
});

test.afterAll(async () => {
  await Promise.all(children.map(async child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await Promise.race([exited, delay(16_000)]);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
  }));
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test('bootstrap, cookie authentication, reload, logout and sign-in through the production proxy', async ({ page }) => {
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Sign in to EAOS' })).toBeVisible();
  await page.getByRole('button', { name: 'First-time administrator setup' }).click();
  await page.getByLabel('Administrator email').fill('browser-fixture@example.invalid');
  await page.getByLabel('Operator setup token').fill(setupToken);
  await page.getByRole('button', { name: 'Create administrator' }).click();
  await expect(page.getByLabel('API key disclosure')).toBeVisible();
  const apiKey = await page.getByLabel('API key disclosure').locator('code').innerText();
  await page.getByRole('button', { name: 'I saved the key' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  expect((await page.request.get(`${base}/_/gateway/api/skills`)).status()).toBe(200);
  expect(await page.evaluate(async () => {
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`/_/gateway${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`Fixture request failed: ${response.status}`);
      return response.json();
    };
    const { session } = await post('/api/chat/sessions', { title: 'transport fixture' });
    const { ticket } = await post('/api/auth/ws-ticket', {});
    return new Promise<boolean>((resolve, reject) => {
      const socket = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/_/gateway/ws`, ['eaos', `eaos-ticket.${ticket}`]);
      const timeout = setTimeout(() => { socket.close(); reject(new Error('Authenticated stream timed out')); }, 8000);
      socket.onopen = () => socket.send(JSON.stringify({ type: 'subscribe', channel: `chat:${session.sessionId}` }));
      socket.onerror = () => { clearTimeout(timeout); reject(new Error('Authenticated stream failed')); };
      socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === 'stream.subscribed') void post(`/api/chat/sessions/${session.sessionId}/messages`, { content: '/transport-fixture' }).catch(reject);
        if (message.type === 'chat.message') { clearTimeout(timeout); socket.close(); resolve(true); }
      };
    });
  })).toBe(true);
  const me = await (await page.request.get(`${base}/_/gateway/api/auth/me`)).json();
  const executionResponse = await page.request.post(`${base}/_/gateway/api/engineering/execute`, { headers: { Origin: base }, data: { skillId: 'eng-007', inputs: { code_or_module: 'fixture only' }, simulate: true } });
  expect(executionResponse.status()).toBe(200);
  const executionId = (await executionResponse.json()).execution.id;
  const ownerHeaders = { Authorization: `Bearer ${fixtureToken(me.user.id)}` };
  const foreignHeaders = { Authorization: `Bearer ${fixtureToken('different-fixture-user')}` };
  expect((await page.request.get(`${base}/_/gateway/api/engineering/executions/${executionId}`, { headers: ownerHeaders })).status()).toBe(200);
  expect((await page.request.get(`${base}/_/gateway/api/engineering/executions/${executionId}`, { headers: foreignHeaders })).status()).toBe(404);
  expect((await page.request.get(`${base}/_/gateway/api/ta/executions/${executionId}`, { headers: ownerHeaders })).status()).toBe(404);
  const foreignList = await (await page.request.get(`${base}/_/gateway/api/engineering/executions`, { headers: foreignHeaders })).json();
  expect(foreignList.executions.some((execution: { id: string }) => execution.id === executionId)).toBe(false);
  const catalogResponse = await page.request.get(`${base}/_/gateway/api/catalog`);
  expect(catalogResponse.status()).toBe(200);
  const catalog = (await catalogResponse.json()).skills;
  expect(catalog).toHaveLength(81);
  for (const persona of ['engineering', 'product', 'marketing', 'hr', 'ta', 'program']) {
    const skill = catalog.find((definition: any) => definition.persona === persona && definition.inputs.every((field: any) => field.type !== 'file' || !field.required));
    const inputs: Record<string, unknown> = {};
    for (const field of skill.inputs.filter((field: any) => field.required)) {
      const option = field.options?.[0];
      const value = typeof option === 'string' ? option : option?.value;
      inputs[field.id] = field.type === 'select' ? value : ['multiselect', 'tags'].includes(field.type) ? [value ?? 'fixture'] : field.type === 'date' ? '2026-01-01' : field.type === 'url' ? 'https://example.invalid/fixture' : field.type === 'number' ? 1 : field.type === 'toggle' ? true : 'fixture content';
    }
    const created = await page.request.post(`${base}/_/gateway/api/execute`, { headers: { Origin: base }, data: { persona, skillId: skill.id, inputs, simulate: true } });
    expect(created.status()).toBe(201);
    const run = (await created.json()).execution;
    expect(run.definitionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(run.mode).toBe('simulation');
    await expect.poll(async () => (await (await page.request.get(`${base}/_/gateway/api/executions/${run.id}`)).json()).execution.status).toBe('simulated');
  }
  const malformed = await page.request.post(`${base}/_/gateway/api/execute`, { headers: { Origin: base }, data: { persona: 'engineering', skillId: 'eng-007', inputs: {}, simulate: true } });
  expect(malformed.status()).toBe(400);
  const live = await page.request.post(`${base}/_/gateway/api/execute`, { headers: { Origin: base }, data: { persona: 'engineering', skillId: 'eng-007', inputs: { code_or_module: 'fixture content' } } });
  expect(live.status()).toBe(201);
  const liveRun = (await live.json()).execution;
  expect(liveRun.mode).toBe('live');
  await expect.poll(async () => (await (await page.request.get(`${base}/_/gateway/api/executions/${liveRun.id}`)).json()).execution.status).toBe('failed');
  expect((await page.request.get(`${base}/_/gateway/api/executions?limit=-1`)).status()).toBe(400);
  expect((await page.request.get(`${base}/_/gateway/api/openapi.json`)).status()).toBe(200);
  const marketingHistory = await (await page.request.get(`${base}/_/gateway/api/executions?persona=marketing`)).json();
  expect(marketingHistory.executions.length).toBeGreaterThan(0);
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored.includes(apiKey)).toBe(false);
  expect(stored.includes(setupToken)).toBe(false);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to EAOS' })).toBeVisible();
  expect((await page.request.get(`${base}/_/gateway/api/skills`)).status()).toBe(401);
  await page.getByLabel('API key', { exact: true }).fill(apiKey);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('button', { name: 'Go to Dashboard', exact: true }).first().click();
  await page.goto(`${base}/admin-settings`);
  await page.getByRole('button', { name: /API Keys/ }).click();
  await expect(page.getByText('bootstrap admin key', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Generate New Key' }).click();
  const disclosure = page.getByLabel('API key disclosure');
  await expect(disclosure).toBeVisible();
  const createdKey = await disclosure.locator('code').innerText();
  await page.getByRole('button', { name: 'I saved the key' }).click();
  await page.getByRole('button', { name: /API Keys/ }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByText('Key 2', { exact: true }).locator('xpath=../..').getByRole('button', { name: 'Rotate' }).click();
  await expect(disclosure).toBeVisible();
  const rotatedKey = await disclosure.locator('code').innerText();
  expect(createdKey !== rotatedKey).toBe(true);
  await page.getByRole('button', { name: 'I saved the key' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to EAOS' })).toBeVisible();
  expect((await page.request.get(`${base}/_/gateway/api/auth/me`, { headers: { 'X-API-Key': createdKey } })).status()).toBe(401);
  await page.getByLabel('API key', { exact: true }).fill(rotatedKey);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /API Keys/ }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByText('Key 2', { exact: true }).locator('xpath=../..').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to EAOS' })).toBeVisible();
  expect((await page.request.get(`${base}/_/gateway/api/auth/me`, { headers: { 'X-API-Key': rotatedKey } })).status()).toBe(401);
});
