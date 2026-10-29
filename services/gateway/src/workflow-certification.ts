import { parse } from 'yaml';
import type { CompiledDefinition } from './definition-registry.js';
import { compileClientRequest } from './workflow-client-adapter.js';
import { getAgentIdentity } from './agent-registry.js';
import { SUPPORTED_CONNECTOR_ACTIONS } from './connector-service.js';
import type { AuthUser } from './auth.js';

export function describeWorkflowSupport(definition: CompiledDefinition) {
  const missing = definition.steps.flatMap(step => {
    if (step.kind !== 'tool_read' && step.kind !== 'tool_effect') return [];
    const action = step.toolAction;
    if (!action) return [{ stepId: step.id, toolId: step.toolId, reason: 'No typed action/input binding' }];
    return SUPPORTED_CONNECTOR_ACTIONS.includes(`${step.toolId}:${action.action}:${action.resourceType}`) ? [] : [{ stepId: step.id, toolId: step.toolId, reason: 'Action transport has not passed conformance' }];
  });
  const external = definition.steps.some(step => ['tool_read','tool_effect'].includes(step.kind));
  return { executionClass: external ? 'external-operation' : 'content-generation', readiness: missing.length ? 'unsupported-bindings' : external ? 'requires-verified-connection' : 'requires-provider', missing, certification: { static: 'compiled', vendorSandbox: 'not-certified', domainReview: 'not-reviewed' } };
}
export function inspectStarterYaml(source: string, principal: AuthUser) {
  if (source.length > 256_000) throw new Error('Starter YAML exceeds its bound');
  const document: unknown = parse(source, { maxAliasCount: 20, uniqueKeys: true, strict: true });
  const entries: unknown[] = Array.isArray(document) ? document : document && typeof document === 'object' && Array.isArray((document as { workflows?: unknown }).workflows) ? (document as { workflows: unknown[] }).workflows : [document];
  if (entries.length > 100) throw new Error('Too many starter definitions');
  return entries.map((value, index) => {
    const item = value as Record<string, any>;
    const id = typeof item?.id === 'string' ? item.id : typeof item?.name === 'string' ? item.name : `entry-${index}`;
    try {
      if (!item || !Array.isArray(item.steps) || !item.steps.length) throw new Error('Starter has no steps');
      const steps = item.steps.map((step: Record<string, any>) => {
        if (!getAgentIdentity(String(step.worker))) throw new Error(`Unknown canonical worker: ${String(step.worker)}`);
        if (step.tools?.length) throw new Error('Starter tool declarations require explicit typed action bindings');
        return { id: step.id, name: step.name ?? step.id, worker: step.worker, action: step.skill ?? step.action, dependsOn: step.depends_on ?? step.dependsOn ?? [], input: step.input ?? {}, condition: step.condition, approval: step.approval, retry: step.retry, timeoutMs: step.timeoutMs };
      });
      const result = compileClientRequest(principal, { format: 'sdk', workflow: { name: item.name ?? id, description: item.description ?? '', version: String(item.version ?? '1'), trigger: { event: item.trigger?.event ?? 'manual' }, priority: item.priority ?? 'normal', steps }, variables: {}, simulate: true });
      return { id, status: 'compiled' as const, definitionHash: result.definition.definitionHash, reason: undefined };
    } catch (error) { return { id, status: 'unsupported' as const, reason: error instanceof Error ? error.message : 'Invalid starter definition', definitionHash: undefined }; }
  });
}
