/**
 * Gateway Validation Schemas — Zod schemas for all inbound API bodies.
 *
 * Import `validate(schema, body)` to parse + throw a structured 400 on failure.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { z } from 'zod';
import { WORKFLOW_PERSONAS, canonicalPersona, type UnifiedInputField } from '@agentos/skills/schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export class ValidationError extends Error {
  readonly statusCode = 400;
  readonly issues: z.ZodIssue[];
  constructor(issues: z.ZodIssue[]) {
    super(issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    this.issues = issues;
    this.name = 'ValidationError';
  }
}

export function validate<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new ValidationError(result.error.issues);
  return result.data;
}

// ---------------------------------------------------------------------------
// Common reusables
// ---------------------------------------------------------------------------

const PersonaEnum = z.preprocess(value => typeof value === 'string' ? canonicalPersona(value) ?? value : value, z.enum(WORKFLOW_PERSONAS));
const ProviderEnum = z.enum(['anthropic', 'openai', 'azure-openai', 'gemini', 'ollama']);

// ---------------------------------------------------------------------------
// POST /api/execute
// ---------------------------------------------------------------------------

export const ExecuteSchema = z.object({
  persona: PersonaEnum,
  skillId: z.string().min(1, 'skillId is required'),
  inputs: z.record(z.string(), z.unknown()).optional().default({}),
  simulate: z.boolean().optional(),
  customPrompt: z.string().max(4000).optional(),
  provider: ProviderEnum.optional(),
  modelId: z.string().max(100).optional(),
});
export type ExecuteBody = z.infer<typeof ExecuteSchema>;

// ---------------------------------------------------------------------------
// POST /api/goal
// ---------------------------------------------------------------------------

export const GoalSchema = z.object({
  goal: z.string().min(1).max(2000),
  persona: PersonaEnum.optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type GoalBody = z.infer<typeof GoalSchema>;

// ---------------------------------------------------------------------------
// POST /api/utcp/packet
// ---------------------------------------------------------------------------

export const UTCPPacketSchema = z.object({
  function: z.string().min(1),
  stage: z.string().min(1),
  intent: z.string().min(1).max(500),
  initiator: z.object({
    user_id: z.string(),
    role: z.string(),
  }),
  objectives: z.array(z.string()).optional().default([]),
  tool_scopes: z.array(z.string()).optional().default([]),
  constraints: z.record(z.string(), z.unknown()).optional(),
});
export type UTCPPacketBody = z.infer<typeof UTCPPacketSchema>;

// ---------------------------------------------------------------------------
// POST /api/a2a/message
// ---------------------------------------------------------------------------

export const A2AMessageSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(['delegation', 'query', 'response', 'approval_request', 'escalation', 'review', 'broadcast']),
  payload: z.record(z.string(), z.unknown()),
  taskId: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});
export type A2AMessageBody = z.infer<typeof A2AMessageSchema>;

// ---------------------------------------------------------------------------
// POST /api/budget/:agentId
// ---------------------------------------------------------------------------

export const BudgetSchema = z.object({
  agentName: z.string().min(1),
  regiment: z.string().optional().default(''),
  period: z.enum(['monthly', 'quarterly', 'annual']).optional().default('monthly'),
  allocatedUsd: z.number().positive(),
  alertThresholdPct: z.number().min(1).max(100).optional().default(80),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
});
export type BudgetBody = z.infer<typeof BudgetSchema>;

// ---------------------------------------------------------------------------
// POST /api/vision
// ---------------------------------------------------------------------------

export const VisionSchema = z.object({
  statement: z.string().min(10).max(2000),
  createdBy: z.string().optional().default('system'),
});
export type VisionBody = z.infer<typeof VisionSchema>;

// ---------------------------------------------------------------------------
// POST /api/webhooks/endpoints
// ---------------------------------------------------------------------------

export const WebhookEndpointSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  secret: z.string().optional(),
  events: z.array(z.string()).optional().default([]),
  enabled: z.boolean().optional().default(true),
});
export type WebhookEndpointBody = z.infer<typeof WebhookEndpointSchema>;

// ---------------------------------------------------------------------------
// POST /api/pipeline/execute
// ---------------------------------------------------------------------------

export const PipelineExecuteSchema = z.object({
  graph: z.object({
    graph_id: z.string().min(1),
    nodes: z.array(z.object({
      id: z.string(),
      type: z.string(),
      agent: z.string().optional(),
      tool: z.string().optional(),
    })),
    edges: z.array(z.object({
      from: z.string(),
      to: z.string(),
      condition: z.string().optional(),
    })).optional().default([]),
  }),
  intent: z.string().min(1).max(1000),
  context: z.record(z.string(), z.unknown()).optional().default({}),
});
export type PipelineExecuteBody = z.infer<typeof PipelineExecuteSchema>;

// ---------------------------------------------------------------------------
// POST /api/notifications/channels
// ---------------------------------------------------------------------------

export const NotificationChannelSchema = z.object({
  channel: z.enum(['slack', 'teams', 'email', 'webhook']),
  name: z.string().min(1).max(100),
  enabled: z.boolean().optional().default(true),
  config: z.record(z.string(), z.unknown()),
});
export type NotificationChannelBody = z.infer<typeof NotificationChannelSchema>;

// ---------------------------------------------------------------------------
// POST /api/experiments
// ---------------------------------------------------------------------------

export const ExperimentSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(''),
  category: z.enum(['model', 'prompt', 'agent', 'skill', 'workflow', 'integration', 'process']),
  hypothesis: z.string().min(1).max(1000),
  successCriteria: z.string().min(1).max(1000),
  proposedBy: z.string().optional().default('system'),
});
export type ExperimentBody = z.infer<typeof ExperimentSchema>;

// ---------------------------------------------------------------------------
// POST /api/chat/sessions
// ---------------------------------------------------------------------------

export const ChatSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  persona: PersonaEnum.optional(),
  agentId: z.string().optional(),
});
export type ChatSessionBody = z.infer<typeof ChatSessionSchema>;

// ---------------------------------------------------------------------------
// POST /api/chat/sessions/:id/messages
// ---------------------------------------------------------------------------

export const ChatMessageSchema = z.object({
  content: z.string().min(1).max(32_000),
  role: z.enum(['user', 'assistant']).optional().default('user'),
});
export type ChatMessageBody = z.infer<typeof ChatMessageSchema>;

export function validateSkillInputs(fields: readonly UnifiedInputField[], body: unknown): Record<string, unknown> {
  const input = validate(z.record(z.string().max(100), z.json()).refine(value => Object.keys(value).length <= 100 && JSON.stringify(value).length <= 128_000, 'Input payload is too large'), body);
  if (Object.hasOwn(input, '_artifacts') || Object.hasOwn(input, '_knowledge')) throw new ValidationError([{ code: 'custom', path: ['_artifacts'], message: 'Artifact evidence is resolved by the server' }]);
  const result: Record<string, unknown> = { ...input };
  for (const field of fields) {
    const choices = field.options?.map(option => typeof option === 'string' ? option : option.value);
    const text = z.string().max(field.type === 'textarea' ? 64_000 : 4000);
    let schema: z.ZodType;
    switch (field.type) {
      case 'text': case 'textarea': schema = field.required ? text.refine(value => value.trim().length > 0, 'Required value is empty') : text; break;
      case 'url': schema = z.url({ protocol: /^https?$/ }).max(4000); break;
      case 'number': schema = z.number().finite(); break;
      case 'toggle': schema = z.boolean(); break;
      case 'date': schema = z.iso.date(); break;
      case 'select': schema = z.string().refine(value => Boolean(choices?.includes(value)), 'Unknown option'); break;
      case 'multiselect': case 'tags': schema = z.array(z.string().max(500).refine(value => !choices || choices.includes(value), 'Unknown option')).max(100).min(field.required ? 1 : 0); break;
      case 'file': {
        const file = z.object({ artifactId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) }).strict();
        schema = field.multiple ? z.array(file).max(20).min(field.required ? 1 : 0) : file;
        break;
      }
      default: throw new ValidationError([{ code: 'custom', path: [field.id], message: 'Unsupported input type' }]);
    }
    const required = field.required && (!field.dependsOn || Boolean(input[field.dependsOn]));
    let value: unknown = input[field.id];
    if (!required && (value === '' || value === null)) value = undefined;
    const parsed = (required ? schema : schema.optional()).safeParse(value);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map(issue => ({ ...issue, path: [field.id, ...issue.path] })));
    if (parsed.data === undefined) delete result[field.id];
    else result[field.id] = parsed.data;
  }
  return result;
}
