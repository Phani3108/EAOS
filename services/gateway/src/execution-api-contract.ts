import { z } from 'zod';
import { EXECUTION_STATUSES, STEP_STATUSES, WORKFLOW_PERSONAS } from '@agentos/skills/schema';
import { ExecuteSchema } from './validation.js';

const Identifier = z.string().min(1).max(200);
const ErrorSchema = z.object({ error: z.string(), code: z.string().optional(), issues: z.array(z.unknown()).optional() });
export const ExecutionStepSchema = z.object({
  stepId: Identifier, stepName: z.string(), agent: Identifier, agentCallSign: z.string().optional(),
  tool: z.string().optional(), status: z.enum(STEP_STATUSES), provenance: z.enum(['live', 'simulated', 'none']),
  kind: z.enum(['llm', 'tool_read', 'tool_effect', 'transform', 'condition', 'join', 'approval', 'subworkflow', 'planner', 'wait']).optional(),
  outputKey: z.string().optional(), outputPreview: z.string().optional(), error: z.string().optional(),
  dependsOn: z.array(Identifier).optional(), startedAt: z.string().optional(), completedAt: z.string().optional(),
  qualityScore: z.number().optional(), tokenCost: z.number().nonnegative().optional(), latencyMs: z.number().nonnegative().optional(),
});
export const ExecutionSnapshotSchema = z.object({
  schemaVersion: z.literal(1), definitionHash: z.string().regex(/^[a-f0-9]{64}$/), definitionVersion: z.string(),
  id: Identifier, tenantId: Identifier, userId: Identifier, persona: z.enum(WORKFLOW_PERSONAS), skillId: Identifier, skillName: z.string(),
  status: z.enum(EXECUTION_STATUSES), mode: z.enum(['live', 'simulation']), executionMode: z.enum(['sequential', 'dag']).optional(),
  steps: z.array(ExecutionStepSchema), inputs: z.record(z.string(), z.unknown()), outputs: z.record(z.string(), z.string()),
  startedAt: z.string(), completedAt: z.string().optional(), totalTokenCost: z.number().optional(), totalLatencyMs: z.number().optional(),
});
export const ExecutionListQuerySchema = z.object({
  persona: z.enum(WORKFLOW_PERSONAS).optional(), status: z.enum(EXECUTION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20), offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type ExecutionSnapshot = z.infer<typeof ExecutionSnapshotSchema>;
export type ExecutionRequest = z.infer<typeof ExecuteSchema>;

export function executionOpenApi() {
  const error = { description: 'Request rejected', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
  const run = { description: 'Execution snapshot', content: { 'application/json': { schema: { type: 'object', required: ['execution'], properties: { execution: { $ref: '#/components/schemas/Execution' } } } } } };
  const id = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
  return {
    openapi: '3.1.0', info: { title: 'EAOS Canonical Execution API', version: '1.0.0' },
    security: [{ browserSession: [] }, { bearer: [] }, { apiKey: [] }],
    paths: {
      '/api/catalog': { get: { operationId: 'listDefinitions', responses: { 200: { description: 'Authorized compiled definitions with schema versions and hashes' }, 401: error } } },
      '/api/execute': { post: { operationId: 'createExecution', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Execute' } } } }, responses: { 201: run, 400: error, 401: error, 403: error, 404: error, 422: error, 503: error } } },
      '/api/executions': { get: { operationId: 'listExecutions', parameters: [
        { name: 'persona', in: 'query', schema: { type: 'string', enum: WORKFLOW_PERSONAS } },
        { name: 'status', in: 'query', schema: { type: 'string', enum: EXECUTION_STATUSES } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
      ], responses: { 200: { description: 'Authorized snapshots, total before pagination, limit and offset' }, 400: error, 401: error } } },
      '/api/executions/{id}': { get: { operationId: 'getExecution', parameters: [id], responses: { 200: run, 401: error, 404: error } } },
      ...Object.fromEntries(['approve', 'reject'].map(decision => [`/api/executions/{id}/${decision}/{stepId}`, { post: { operationId: `${decision}ExecutionStep`, parameters: [id, { name: 'stepId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Decision recorded, not execution completion' }, 400: error, 401: error, 403: error, 404: error, 409: error } } }])),
    },
    components: {
      securitySchemes: { browserSession: { type: 'apiKey', in: 'cookie', name: 'eaos_refresh' }, bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
      schemas: { Execute: z.toJSONSchema(ExecuteSchema, { io: 'output' }), Execution: z.toJSONSchema(ExecutionSnapshotSchema), Error: z.toJSONSchema(ErrorSchema) },
    },
  };
}
