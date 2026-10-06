import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { integrationDigest, type ConnectorManifest } from '@agentos/db/integration-repository';

export const repositoryName = z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/).max(200).refine(value => value.split('/').every(part => part !== '.' && part !== '..'), 'Invalid repository path');
const text = z.string().min(1).max(64_000);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const issueKey = z.string().regex(/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/);
const channel = z.string().regex(/^[CG][A-Z0-9]{2,40}$/);
const ts = z.string().regex(/^\d{10,}\.\d+$/);
const description = z.object({ type: z.literal('doc'), version: z.literal(1), content: z.array(z.json()).max(10_000) }).strict().nullable();
export const actionSchemas = {
  'github:read:pull_request': z.object({ repository: repositoryName, number: z.number().int().positive() }).strict(),
  'github:comment:pull_request': z.object({ repository: repositoryName, number: z.number().int().positive(), body: text }).strict(),
  'jira:read:issue': z.object({ key: issueKey }).strict(),
  'jira:create:issue': z.object({ project: z.string().regex(/^[A-Z][A-Z0-9_]*$/), summary: z.string().min(1).max(255), description: text, issueType: z.enum(['Task','Story','Epic']).default('Task'), parent: issueKey.optional() }).strict(),
  'slack:create:message': z.object({ channel, text }).strict(),
  'slack:read:message': z.object({ channel, ts }).strict(),
};
export const outputSchemas = {
  'github:read:pull_request': z.object({ id: z.number().int().positive(), number: z.number().int().positive(), repository: repositoryName, title: text, body: z.string().max(64_000), headSha: sha, baseSha: sha, files: z.array(z.object({ filename: text, patch: z.string().max(64_000), status: text })).max(100), potentiallyTruncated: z.literal(false), verified: z.literal(true) }).strict(),
  'github:comment:pull_request': z.object({ id: z.number().int().positive(), repository: repositoryName, number: z.number().int().positive(), body: text, verified: z.literal(true) }).strict(),
  'jira:read:issue': z.object({ id: text, key: issueKey, summary: text, description, parent: issueKey.nullable(), verified: z.literal(true) }).strict(),
  'jira:create:issue': z.object({ id: text, key: issueKey, summary: text, description, parent: issueKey.nullable(), verified: z.literal(true) }).strict(),
  'slack:read:message': z.object({ channel, ts, text: z.string().max(64_000), verified: z.literal(true) }).strict(),
  'slack:create:message': z.object({ channel, ts, text, verified: z.literal(true) }).strict(),
};
export const SUPPORTED_CONNECTOR_ACTIONS = Object.freeze(Object.keys(actionSchemas));
const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
const buildHash = integrationDigest(['connector-contracts','connector-service','outbound-http'].map(name => readFileSync(new URL(`./${name}${extension}`, import.meta.url), 'utf8')));
export function connectorContract(id: string) {
  if (!['github','jira','slack'].includes(id)) throw new Error('No registered native connector');
  const actions = SUPPORTED_CONNECTOR_ACTIONS.filter(action => action.startsWith(`${id}:`)).sort().map(action => ({ id: action, effect: !action.includes(':read:'), inputSchema: z.toJSONSchema(actionSchemas[action as keyof typeof actionSchemas], { io: 'input' }), outputSchema: z.toJSONSchema(outputSchemas[action as keyof typeof outputSchemas]), scope: id === 'github' ? 'repository' : id === 'jira' ? 'project' : 'channel' }));
  const policy = { approval: 'required-for-effects', duplicateWrites: 'durable-receipt-or-inconclusive', postcondition: 'scoped-identity-and-content-readback', egress: 'pinned-https-no-redirects', partialEvidence: 'reject', credentials: 'owner-scoped-version-pinned', transportBudgetMs: 30_000 };
  return { id, adapterVersion: 'native-v2', adapterHash: integrationDigest({ buildHash, id, actions, policy }), actions, policy };
}
export function compileConnectorManifest(input: unknown): ConnectorManifest {
  const raw = z.object({ schemaVersion: z.union([z.literal(1), z.literal(2)]), id: z.enum(['github','jira','slack']), actions: z.array(z.string()).min(1).max(6), adapterVersion: z.string().optional(), adapterHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().parse(input);
  if (new Set(raw.actions).size !== raw.actions.length || raw.actions.some(action => !action.startsWith(`${raw.id}:`) || !SUPPORTED_CONNECTOR_ACTIONS.includes(action))) throw new Error('Manifest actions must be unique registered actions of its connector');
  const contract = connectorContract(raw.id);
  if (raw.schemaVersion === 1 && (raw.adapterHash || raw.adapterVersion) || raw.schemaVersion === 2 && (raw.adapterHash !== contract.adapterHash || raw.adapterVersion !== contract.adapterVersion)) throw new Error('Adapter fingerprint changed or is untrusted; restage the manifest');
  return { schemaVersion: 2, id: raw.id, actions: [...raw.actions].sort(), adapterHash: contract.adapterHash, adapterVersion: contract.adapterVersion };
}
