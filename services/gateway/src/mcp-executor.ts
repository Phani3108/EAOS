/**
 * MCP Tool Executor — Standardized tool interface for all connectors.
 * Every meaningful action (create ticket, push code, send campaign) goes through MCP.
 * Agents orchestrate; MCP executes.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { randomUUID } from 'crypto';
import { tryRealExecute } from './real-executor.js';
import { checkPolicy } from './policy-store.js';
import { ToolSandbox } from '@agentos/sandbox';

const toolSandbox = new ToolSandbox();

// ═══════════════════════════════════════════════════════════════
// Core Types
// ═══════════════════════════════════════════════════════════════

export type MCPAction = 'search' | 'read' | 'create' | 'update' | 'delete' | 'comment' | 'trigger' | 'fetch_metadata' | 'subscribe' | 'list' | 'execute';

export type MCPStatus = 'success' | 'error' | 'timeout' | 'rate_limited' | 'auth_failed' | 'not_connected';

export interface MCPToolAction {
  action_id: string;
  tool_id: string;
  action: MCPAction;
  resource_type: string;         // e.g., 'issue', 'pull_request', 'campaign', 'candidate'
  params: Record<string, unknown>;
  auth: {
    type: 'api_key' | 'oauth' | 'bearer' | 'basic' | 'sandbox';
    credentials_ref: string;     // Reference to stored credentials
  };
  timeout_ms: number;
  retry_policy: {
    max_retries: number;
    backoff: 'none' | 'linear' | 'exponential';
    base_delay_ms: number;
  };
  context: {
    task_ref: string;            // UTCP task_id
    agent_id: string;            // Which agent requested this
    step_index: number;          // Which step in the workflow
  };
}

export interface MCPToolResponse {
  action_id: string;
  tool_id: string;
  action: MCPAction;
  status: MCPStatus;
  data: Record<string, unknown>;
  error?: string;
  latency_ms: number;
  cost_usd?: number;
  rate_limit?: {
    remaining: number;
    reset_at: string;
  };
  metadata: {
    request_at: string;
    response_at: string;
    retries: number;
    cached: boolean;
  };
}

// ═══════════════════════════════════════════════════════════════
// Tool Capability Registry
// ═══════════════════════════════════════════════════════════════

export interface MCPToolCapability {
  tool_id: string;
  name: string;
  category: string;
  supported_actions: MCPAction[];
  resource_types: string[];
  rate_limits: { requests_per_minute: number; burst: number };
  auth_types: string[];
  sandbox_available: boolean;
}

const TOOL_CAPABILITIES: MCPToolCapability[] = [
  {
    tool_id: 'jira',
    name: 'Jira Software',
    category: 'project-management',
    supported_actions: ['search', 'read', 'create', 'update', 'comment', 'list', 'fetch_metadata'],
    resource_types: ['issue', 'epic', 'sprint', 'board', 'project', 'comment', 'attachment'],
    rate_limits: { requests_per_minute: 100, burst: 20 },
    auth_types: ['api_key', 'oauth'],
    sandbox_available: true,
  },
  {
    tool_id: 'github',
    name: 'GitHub',
    category: 'dev-tools',
    supported_actions: ['search', 'read', 'create', 'update', 'comment', 'list', 'fetch_metadata', 'trigger'],
    resource_types: ['repository', 'pull_request', 'issue', 'commit', 'branch', 'workflow_run', 'release', 'comment'],
    rate_limits: { requests_per_minute: 60, burst: 10 },
    auth_types: ['api_key', 'oauth'],
    sandbox_available: true,
  },
  {
    tool_id: 'slack',
    name: 'Slack',
    category: 'messaging',
    supported_actions: ['read', 'create', 'search', 'list', 'subscribe'],
    resource_types: ['message', 'channel', 'thread', 'reaction', 'file'],
    rate_limits: { requests_per_minute: 50, burst: 10 },
    auth_types: ['oauth'],
    sandbox_available: true,
  },
  {
    tool_id: 'confluence',
    name: 'Confluence',
    category: 'documentation',
    supported_actions: ['search', 'read', 'create', 'update', 'list', 'fetch_metadata'],
    resource_types: ['page', 'space', 'blog_post', 'comment', 'attachment'],
    rate_limits: { requests_per_minute: 100, burst: 20 },
    auth_types: ['api_key', 'oauth'],
    sandbox_available: true,
  },
  {
    tool_id: 'hubspot',
    name: 'HubSpot',
    category: 'crm',
    supported_actions: ['search', 'read', 'create', 'update', 'list', 'fetch_metadata', 'trigger'],
    resource_types: ['contact', 'company', 'deal', 'campaign', 'email', 'form', 'workflow', 'list'],
    rate_limits: { requests_per_minute: 100, burst: 15 },
    auth_types: ['api_key', 'oauth'],
    sandbox_available: true,
  },
  {
    tool_id: 'google_analytics',
    name: 'Google Analytics 4',
    category: 'analytics',
    supported_actions: ['read', 'search', 'list', 'fetch_metadata'],
    resource_types: ['report', 'dimension', 'metric', 'audience', 'event'],
    rate_limits: { requests_per_minute: 60, burst: 10 },
    auth_types: ['oauth'],
    sandbox_available: false,
  },
  {
    tool_id: 'linkedin_ads',
    name: 'LinkedIn Ads',
    category: 'advertising',
    supported_actions: ['read', 'create', 'update', 'list', 'fetch_metadata'],
    resource_types: ['campaign', 'ad', 'audience', 'creative', 'analytics'],
    rate_limits: { requests_per_minute: 80, burst: 10 },
    auth_types: ['oauth'],
    sandbox_available: true,
  },
  {
    tool_id: 'figma',
    name: 'Figma',
    category: 'design',
    supported_actions: ['read', 'list', 'fetch_metadata', 'comment'],
    resource_types: ['file', 'component', 'style', 'comment', 'version'],
    rate_limits: { requests_per_minute: 30, burst: 5 },
    auth_types: ['api_key', 'oauth'],
    sandbox_available: false,
  },
];

// ═══════════════════════════════════════════════════════════════
// Executor
// ═══════════════════════════════════════════════════════════════

// Credential store (in-memory, would be Vault/KMS in production)
const credentials = new Map<string, Record<string, string>>();

export function storeCredentials(ref: string, creds: Record<string, string>): void {
  credentials.set(ref, creds);
}

export function getCredentials(ref: string): Record<string, string> | undefined {
  return credentials.get(ref);
}

// Real MCP resolver (Phase 0) — injected from server.ts to avoid a circular import.
// Returns the tool result when a connected MCP server handles the action, else null
// (so legacy connectors / simulation remain the fallback). Matches only MCP-server
// tool_ids, so existing jira/github/slack/etc. behaviour is unchanged.
type McpResolver = (action: MCPToolAction) => Promise<Record<string, unknown> | null>;
let mcpResolver: McpResolver | null = null;
export function setMcpResolver(fn: McpResolver | null): void { mcpResolver = fn; }

// Execution log
const executionLog: MCPToolResponse[] = [];

export async function executeMCPAction(action: MCPToolAction): Promise<MCPToolResponse> {
  const startTime = Date.now();
  const capability = TOOL_CAPABILITIES.find(t => t.tool_id === action.tool_id);

  // Validate tool exists
  if (!capability) {
    const response = buildResponse(action, 'error', {}, `Unknown tool: ${action.tool_id}`, startTime);
    executionLog.push(response);
    return response;
  }

  // Validate action supported
  if (!capability.supported_actions.includes(action.action)) {
    const response = buildResponse(action, 'error', {}, `Action '${action.action}' not supported by ${action.tool_id}`, startTime);
    executionLog.push(response);
    return response;
  }

  // Check credentials
  const creds = credentials.get(action.auth.credentials_ref);
  if (!creds && action.auth.type !== 'sandbox') {
    const response = buildResponse(action, 'auth_failed', {}, `No credentials found for ref: ${action.auth.credentials_ref}`, startTime);
    executionLog.push(response);
    return response;
  }

  // Sandbox check — risk tier enforcement before any execution
  const taskId = action.action_id;
  const sandboxResult = toolSandbox.check(action.tool_id, taskId);
  if (!sandboxResult.allowed) {
    const response = buildResponse(action, 'error', { riskTier: sandboxResult.tier }, sandboxResult.violations.join('; '), startTime);
    executionLog.push(response);
    return response;
  }
  if (sandboxResult.requiresApproval) {
    // High/critical tools surface as pending — callers (persona-api) handle approval gate
    const response = buildResponse(action, 'error', { riskTier: sandboxResult.tier, requiresApproval: true }, `Tool '${action.tool_id}' requires human approval (${sandboxResult.tier})`, startTime);
    executionLog.push(response);
    return response;
  }
  toolSandbox.recordCall(action.tool_id, taskId);

  // Execute with retry
  let lastError = '';
  for (let attempt = 0; attempt <= action.retry_policy.max_retries; attempt++) {
    try {
      const result = await executeToolCall(action, capability, creds);
      const response = buildResponse(action, 'success', result, undefined, startTime, attempt);
      executionLog.push(response);
      return response;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < action.retry_policy.max_retries) {
        const delay = action.retry_policy.backoff === 'exponential'
          ? action.retry_policy.base_delay_ms * Math.pow(2, attempt)
          : action.retry_policy.base_delay_ms * (attempt + 1);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  const response = buildResponse(action, 'error', {}, lastError, startTime, action.retry_policy.max_retries);
  executionLog.push(response);
  return response;
}

// Tool call — tries real connector first (when env credentials are set),
// falls back to deterministic simulated response otherwise. The simulated
// output is still useful for demo flows and development without live APIs.
async function executeToolCall(
  action: MCPToolAction,
  capability: MCPToolCapability,
  _creds: Record<string, string> | undefined
): Promise<Record<string, unknown>> {
  // Policy gate — deny-first. If any enabled policy denies this (tool, persona,
  // agent) combo, refuse before hitting the vendor API. Errors here surface to
  // the retry loop but never actually execute.
  const policy = checkPolicy({ tool: action.tool_id });
  if (!policy.allowed) {
    const reasons = policy.matchedDenies.map((d) => d.reason).join('; ');
    throw new Error(`Denied by policy: ${reasons}`);
  }

  // Real MCP server first (Phase 0). Resolves only when tool_id is a connected MCP
  // server; returns null otherwise, leaving legacy connectors/simulation untouched.
  if (mcpResolver) {
    const viaMcp = await mcpResolver(action);
    if (viaMcp) return viaMcp;
  }

  // Attempt real execution first. Returns null if connector is not wired for
  // this tool/action or if env credentials are missing; throws on API error,
  // which propagates to the retry loop above.
  try {
    const real = await tryRealExecute({
      tool_id: action.tool_id,
      action: action.action,
      resource_type: action.resource_type,
      params: action.params,
    });
    if (real) return real;
  } catch (err) {
    // Real connector threw — rethrow so mcp-executor retry loop can decide
    // whether to retry or return failure. Do NOT fall back to simulation on
    // a real API error; that would mask genuine failures.
    throw err;
  }

  // No real connector available — simulate
  await new Promise(r => setTimeout(r, 50 + Math.random() * 200));

  const simulated: Record<string, unknown> = {
    tool: action.tool_id,
    action: action.action,
    resource_type: action.resource_type,
    simulated: true,
  };

  switch (action.action) {
    case 'create':
      return { ...simulated, id: `${action.tool_id}-${randomUUID().slice(0, 8)}`, created: true, url: `https://${action.tool_id}.example.com/item/${randomUUID().slice(0, 8)}` };
    case 'read':
      return { ...simulated, found: true, data: { id: action.params.id, title: 'Sample Item', status: 'active' } };
    case 'search':
      return { ...simulated, results: [{ id: '1', title: 'Result 1' }, { id: '2', title: 'Result 2' }], total: 2 };
    case 'update':
      return { ...simulated, updated: true, id: action.params.id };
    case 'list':
      return { ...simulated, items: [], total: 0, page: 1 };
    case 'comment':
      return { ...simulated, comment_id: `comment-${randomUUID().slice(0, 8)}`, posted: true };
    case 'trigger':
      return { ...simulated, triggered: true, run_id: `run-${randomUUID().slice(0, 8)}` };
    default:
      return simulated;
  }
}

function buildResponse(
  action: MCPToolAction,
  status: MCPStatus,
  data: Record<string, unknown>,
  error: string | undefined,
  startTime: number,
  retries = 0
): MCPToolResponse {
  const now = new Date().toISOString();
  return {
    action_id: action.action_id,
    tool_id: action.tool_id,
    action: action.action,
    status,
    data,
    error,
    latency_ms: Date.now() - startTime,
    metadata: {
      request_at: new Date(startTime).toISOString(),
      response_at: now,
      retries,
      cached: false,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════

export function createMCPAction(params: {
  tool_id: string;
  action: MCPAction;
  resource_type: string;
  params: Record<string, unknown>;
  task_ref: string;
  agent_id: string;
  step_index?: number;
  credentials_ref?: string;
}): MCPToolAction {
  return {
    action_id: `mcp-${randomUUID()}`,
    tool_id: params.tool_id,
    action: params.action,
    resource_type: params.resource_type,
    params: params.params,
    auth: {
      type: 'sandbox',
      credentials_ref: params.credentials_ref || `cred-${params.tool_id}`,
    },
    timeout_ms: 30000,
    retry_policy: { max_retries: 2, backoff: 'exponential', base_delay_ms: 1000 },
    context: {
      task_ref: params.task_ref,
      agent_id: params.agent_id,
      step_index: params.step_index || 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// Query Functions
// ═══════════════════════════════════════════════════════════════

export function getToolCapabilities(): MCPToolCapability[] {
  return TOOL_CAPABILITIES;
}

export function getToolCapability(toolId: string): MCPToolCapability | undefined {
  return TOOL_CAPABILITIES.find(t => t.tool_id === toolId);
}

export function getExecutionLog(limit = 100): MCPToolResponse[] {
  return executionLog.slice(-limit);
}

export function getExecutionLogByTask(taskRef: string): MCPToolResponse[] {
  // Match by action_id prefix or filter stored context
  return executionLog.filter(r => r.action_id.includes(taskRef));
}

export function getToolStats(): Record<string, { calls: number; success: number; errors: number; avg_latency_ms: number }> {
  const stats: Record<string, { calls: number; success: number; errors: number; total_latency: number }> = {};
  for (const log of executionLog) {
    if (!stats[log.tool_id]) {
      stats[log.tool_id] = { calls: 0, success: 0, errors: 0, total_latency: 0 };
    }
    stats[log.tool_id].calls++;
    if (log.status === 'success') stats[log.tool_id].success++;
    else stats[log.tool_id].errors++;
    stats[log.tool_id].total_latency += log.latency_ms;
  }
  const result: Record<string, { calls: number; success: number; errors: number; avg_latency_ms: number }> = {};
  for (const [toolId, s] of Object.entries(stats)) {
    result[toolId] = { ...s, avg_latency_ms: Math.round(s.total_latency / s.calls) };
  }
  return result;
}
