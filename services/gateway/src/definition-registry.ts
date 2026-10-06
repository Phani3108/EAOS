import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateSkillInputs } from './validation.js';
import { validateGraph } from '@agentos/sdk';
import { evalSafeExpression } from '@agentos/workflow-engine';
import { canonicalPersona, WORKFLOW_PERSONAS, MARKETING_INPUT_FIELDS, type UnifiedSkillDef, type UnifiedStepDef, type WorkflowPersona, type PersonaId, type StepKind } from '@agentos/skills/schema';
import { resolveCatalogAgent } from './agent-registry.js';
import { canonicalToolId, toolRegistry } from './tool-registry.js';
import { ENGINEERING_SKILLS } from './engineering-skills-data.js';
import { PRODUCT_SKILLS } from './product-skills-data.js';
import { HR_SKILLS } from './hr-skills-data.js';
import { TA_SKILLS } from './ta-skills-data.js';
import { PROGRAM_SKILLS } from './program-skills-data.js';
import { MARKETING_WORKFLOW_REFS } from './marketing-workflows-data.js';
import { FLAGSHIP_WORKFLOWS } from './flagship-workflows.js';

export interface CompiledStep extends UnifiedStepDef {
  agentLabel: string;
  agentDefinitionHash: string;
  agentPersona: PersonaId;
  toolId: string;
  toolLabel: string;
  kind: StepKind;
  dependsOn: string[];
}
export interface CompiledDefinition extends Omit<UnifiedSkillDef, 'persona' | 'steps'> {
  persona: WorkflowPersona;
  steps: CompiledStep[];
  schemaVersion: 1;
  version: string;
  definitionHash: string;
}

const STEP_OVERRIDES: Record<string, Partial<Pick<CompiledStep, 'agent' | 'toolId' | 'kind'>>> = {
  'fw-001:fw-001-s6': { agent: 'sprint-planner' },
  'fw-002:fw-002-s1': { agent: 'debug-specialist' },
  'fw-002:fw-002-s2': { kind: 'tool_read' },
  'fw-002:fw-002-s4': { agent: 'debug-specialist' },
  'fw-002:fw-002-s5': { agent: 'tech-lead' },
  'fw-002:fw-002-s7': { agent: 'docs-writer' },
  'fw-003:fw-003-s3': { agent: 'product-strategist' },
  'fw-003:fw-003-s5': { toolId: 'llm', kind: 'llm' },
  'fw-003:fw-003-s6': { agent: 'seo-analyst', kind: 'tool_read' },
  'fw-004:fw-004-s5': { agent: 'test-writer' },
  'wf-001:s3': { toolId: 'llm', kind: 'llm' },
  'wf-013:s3': { toolId: 'llm', kind: 'llm' },
  'wf-016:s2': { toolId: 'llm', kind: 'llm' },
  'wf-017:s3': { toolId: 'llm', kind: 'llm' },
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function compileDefinition(raw: UnifiedSkillDef, ancestry: string[] = [], budget = { steps: 0 }): CompiledDefinition {
  if (ancestry.length > 5 || ancestry.includes(raw.id)) throw new Error('Subworkflow recursion/depth limit exceeded');
  budget.steps += raw.steps.length;
  if (budget.steps > 1024) throw new Error('Expanded workflow exceeds the node bound');
  if (raw.maxConcurrency !== undefined && (!Number.isInteger(raw.maxConcurrency) || raw.maxConcurrency < 1 || raw.maxConcurrency > 16)) throw new Error('Invalid workflow concurrency');
  raw = { ...raw, inputs: raw.persona === 'marketing' ? MARKETING_INPUT_FIELDS[raw.id] ?? raw.inputs : raw.inputs };
  const persona = canonicalPersona(raw.persona);
  if (!persona || !(WORKFLOW_PERSONAS as readonly string[]).includes(persona)) throw new Error(`Unsupported workflow persona: ${raw.persona}`);
  if (!raw.id || !raw.slug || !raw.name || !raw.steps.length) throw new Error('Definition identity and steps are required');
  const ids = new Set<string>();
  const outputs = new Set<string>();
  const steps: CompiledStep[] = raw.steps.map((step, index) => {
    if (!step.id || ids.has(step.id)) throw new Error(`Duplicate or missing step ID: ${step.id}`);
    if (!step.outputKey || outputs.has(step.outputKey)) throw new Error(`Duplicate or missing output key: ${step.outputKey}`);
    ids.add(step.id); outputs.add(step.outputKey);
    const override = STEP_OVERRIDES[`${raw.id}:${step.id}`];
    const agentPersona = canonicalPersona(step.agentPersona ?? persona);
    if (!agentPersona) throw new Error(`Unknown agent persona for ${step.id}`);
    const agent = resolveCatalogAgent(override?.agent ?? step.agent, agentPersona);
    if (!agent) throw new Error(`Unknown agent ${step.agent} in ${raw.id}/${step.id}`);
    const toolId = canonicalToolId(override?.toolId ?? step.toolId ?? step.tool ?? 'llm');
    if (!toolId) throw new Error(`Unknown tool ${step.tool} in ${raw.id}/${step.id}`);
    const operation = step.toolAction;
    if (operation && (!['read', 'search', 'list', 'fetch_metadata', 'create', 'update', 'delete', 'comment', 'trigger', 'subscribe'].includes(operation.action) || !operation.resourceType || Object.values(operation.inputBindings).some(value => !/^(inputs|outputs)\.[a-zA-Z0-9_.-]+$/.test(value)))) throw new Error(`Unsupported tool action or input binding in ${step.id}`);
    const kind = override?.kind ?? step.kind ?? (toolId === 'llm' ? 'llm' : operation && ['read', 'search', 'list', 'fetch_metadata'].includes(operation.action) || step.capability?.startsWith('scm.read') ? 'tool_read' : 'tool_effect');
    if (kind === 'subworkflow' && !step.subworkflow?.definition || step.subworkflow && kind !== 'subworkflow') throw new Error(`Invalid subworkflow contract in ${step.id}`);
    const child = step.subworkflow ? compileDefinition(step.subworkflow.definition, [...ancestry, raw.id], budget) : undefined;
    if (kind === 'planner' && (!step.planCandidates?.length || step.planCandidates.length > 81) || step.planCandidates && kind !== 'planner') throw new Error('Invalid planner candidate manifest');
    const candidates = step.planCandidates?.map(candidate => compileDefinition(candidate, [...ancestry, raw.id], budget));
    if (step.transformExpression !== undefined) { if (kind !== 'transform' || step.transformExpression.length > 4000) throw new Error('Invalid transform expression'); evalSafeExpression(step.transformExpression, {}); }
    if (step.timeoutMs !== undefined && (!Number.isInteger(step.timeoutMs) || step.timeoutMs < 1 || step.timeoutMs > 86_400_000)) throw new Error('Invalid node deadline');
    if (step.retry && (!Number.isInteger(step.retry.maxAttempts) || step.retry.maxAttempts < 1 || step.retry.maxAttempts > 6 || !Number.isFinite(step.retry.backoffMs) || step.retry.backoffMs < 0 || step.retry.backoffMs > 60_000)) throw new Error('Invalid node retry policy');
    if (step.approvalTimeoutMs !== undefined && (!Number.isInteger(step.approvalTimeoutMs) || step.approvalTimeoutMs < 1000 || step.approvalTimeoutMs > 604_800_000)) throw new Error('Invalid approval deadline');
    if (step.approvalApprovers && (step.approvalApprovers.length > 30 || step.approvalApprovers.some(id => typeof id !== 'string' || !id || id.length > 200))) throw new Error('Invalid approval approvers');
    if (step.retry?.strategy && !['fixed','linear','exponential'].includes(step.retry.strategy)) throw new Error('Invalid retry strategy');
    if (step.approvalFields && (step.approvalFields.length > 30 || step.approvalFields.some(field => !/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(field)))) throw new Error('Invalid approval confirmation fields');
    if (step.taskPrompt !== undefined && (typeof step.taskPrompt !== 'string' || step.taskPrompt.length > 20_000)) throw new Error('Task prompt exceeds its bound');
    if (step.outputRequirements && ((step.outputRequirements.sections?.length ?? 0) > 100 || step.outputRequirements.sections?.some(section => typeof section !== 'string' || !section || section.length > 200) || !Number.isInteger(step.outputRequirements.minCitations ?? 0) || (step.outputRequirements.minCitations ?? 0) < 0 || (step.outputRequirements.minCitations ?? 0) > 100)) throw new Error('Invalid output requirements');
    return {
      ...step, ...(child ? { subworkflow: { definition: child } } : {}), ...(candidates ? { planCandidates: candidates } : {}), order: index + 1, agent: agent.id, agentDefinitionHash: createHash('sha256').update(stableJson(agent)).digest('hex'), agentLabel: step.agentLabel ?? step.agent, agentPersona,
      tool: toolId, toolId, toolLabel: toolRegistry.get(toolId)!.name, kind,
      requiresApproval: step.requiresApproval === true || kind === 'tool_effect',
      dependsOn: [...new Set(step.dependsOn ?? [])],
    };
  });
  for (const edge of raw.edges ?? []) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) throw new Error(`Unknown dependency edge in ${raw.id}`);
    if (edge.condition) { if (edge.condition.length > 4000) throw new Error('Edge condition is too large'); evalSafeExpression(edge.condition, {}); }
    const target = steps.find(step => step.id === edge.to)!;
    if (!target.dependsOn.includes(edge.from)) target.dependsOn.push(edge.from);
  }
  if (raw.executionMode !== 'dag' && !raw.edges?.length && !steps.some(step => step.dependsOn.length || step.kind === 'condition')) {
    for (let i = 1; i < steps.length; i++) steps[i]!.dependsOn = [steps[i - 1]!.id];
  }
  for (const step of steps) {
    if (step.kind === 'condition') {
      if (!step.condition || !ids.has(step.condition.trueStep) || !ids.has(step.condition.falseStep) || step.condition.expression.length > 4000) throw new Error(`Invalid condition in ${step.id}`);
      evalSafeExpression(step.condition.expression, {});
      for (const targetId of [step.condition.trueStep, step.condition.falseStep]) {
        const target = steps.find(candidate => candidate.id === targetId)!;
        if (!target.dependsOn.includes(step.id)) target.dependsOn.push(step.id);
      }
    }
    if (step.kind === 'wait' && (!Number.isInteger(step.waitMs) || step.waitMs! < 0 || step.waitMs! > 604_800_000)) throw new Error(`Invalid wait in ${step.id}`);
  }
  if (raw.executionMode === 'sequential' && steps.some(step => step.kind === 'condition')) throw new Error('Conditional definitions require DAG execution mode');
  validateGraph(steps, steps.flatMap(step => step.dependsOn.map(from => ({ from, to: step.id }))));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    if (!ids.has(id)) throw new Error(`Unknown dependency ${id}`);
    if (visiting.has(id)) throw new Error(`Dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of steps.find(step => step.id === id)!.dependsOn) visit(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const step of steps) visit(step.id);
  if (raw.outputs.some(output => !outputs.has(output))) throw new Error(`Missing declared output producer in ${raw.id}`);
  if (new Set(raw.inputs.map(input => input.id)).size !== raw.inputs.length) throw new Error(`Duplicate input fields in ${raw.id}`);
  const resolveTools = (tools: string[]) => [...new Set(tools.map(tool => {
    const id = canonicalToolId(tool);
    if (!id) throw new Error(`Unknown required tool ${tool} in ${raw.id}`);
    return id;
  }))];
  const definition = { ...raw, persona: persona as WorkflowPersona, steps, requiredTools: resolveTools(raw.requiredTools), optionalTools: resolveTools(raw.optionalTools), schemaVersion: 1 as const, executionMode: raw.executionMode ?? (raw.edges?.length || raw.steps.some(step => step.dependsOn?.length || step.kind === 'condition') ? 'dag' as const : 'sequential' as const), version: raw.version ?? '1.0.0', definitionHash: undefined };
  return { ...definition, definitionHash: createHash('sha256').update(stableJson(definition)).digest('hex') };
}

export function compileTaskPlan(value: unknown, candidates: CompiledDefinition[], persona: WorkflowPersona): CompiledDefinition {
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    value = JSON.parse(trimmed);
  }
  const identity = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/);
  const plan = z.object({ reasoning: z.string().max(4000).optional(), tasks: z.array(z.object({ id: identity, name: z.string().max(240).optional(), description: z.string().max(4000).optional(), skill: z.string().min(1).max(200), persona: z.enum(WORKFLOW_PERSONAS).optional(), agent: z.string().max(200).optional(), dependencies: z.array(identity).max(12).default([]), input: z.record(z.string(), z.unknown()).default({}) }).strict()).min(1).max(12) }).strict().parse(value);
  const steps: UnifiedStepDef[] = plan.tasks.map((task, index) => {
    const matches = candidates.filter(candidate => (candidate.id === task.skill || candidate.slug === task.skill) && (!task.persona || task.persona === candidate.persona));
    if (matches.length !== 1) throw new Error(`Planner selected an unknown or ambiguous skill: ${task.skill}`);
    const definition = matches[0]!;
    const agent = task.agent ? resolveCatalogAgent(task.agent, definition.persona)?.id : definition.steps[0]!.agent;
    if (!agent || !definition.steps.some(step => step.agent === agent)) throw new Error('Planner selected an agent outside the skill contract');
    if (!JSON.stringify(task.input).includes('$ref') && !JSON.stringify(task.input).includes('{{')) validateSkillInputs(definition.inputs, task.input);
    for (const field of definition.inputs.filter(field => field.required)) if (task.input[field.id] === undefined) throw new Error(`Planner omitted required input: ${field.id}`);
    return { id: task.id, order: index + 1, name: task.name ?? definition.name, agent, agentPersona: definition.persona, kind: 'subworkflow', tool: 'llm', outputKey: task.id, dependsOn: task.dependencies, inputBindings: task.input, subworkflow: { definition } };
  });
  return compileDefinition({ id: `plan-${createHash('sha256').update(stableJson(plan)).digest('hex').slice(0,24)}`, slug: 'validated-task-plan', name: 'Validated task plan', description: plan.reasoning ?? '', icon: '', persona, executableType: 'workflow', cluster: 'Orchestration', complexity: 'complex', estimatedTime: '', executionMode: 'dag', inputs: [], steps, outputs: steps.map(step => step.outputKey), requiredTools: [], optionalTools: [], tags: ['compiled-plan'] });
}

export function requiredPersonas(definition: UnifiedSkillDef): PersonaId[] {
  const ownPersona = canonicalPersona(definition.persona);
  if (!ownPersona) throw new Error('Unknown definition persona');
  const personas = new Set<PersonaId>([ownPersona]);
  for (const step of definition.steps) {
    const agentPersona = canonicalPersona(step.agentPersona ?? ownPersona);
    if (!agentPersona) throw new Error('Unknown step persona');
    personas.add(agentPersona);
    if (step.subworkflow) for (const persona of requiredPersonas(step.subworkflow.definition)) personas.add(persona);
    for (const candidate of step.planCandidates ?? []) for (const persona of requiredPersonas(candidate)) personas.add(persona);
  }
  return [...personas];
}

export function getCompiledCatalog(): CompiledDefinition[] {
  const flagships: UnifiedSkillDef[] = FLAGSHIP_WORKFLOWS.map(workflow => ({
    ...workflow, persona: canonicalPersona(workflow.personas[0]!)!, executableType: 'workflow', cluster: 'Flagship',
    complexity: workflow.complexity === 'critical' ? 'complex' : workflow.complexity,
    inputs: workflow.inputs.map(input => ({ ...input, type: input.type as 'text' | 'textarea', section: 'basic' })),
    steps: workflow.steps.map((step, index) => ({ ...step, order: index + 1, agentPersona: canonicalPersona(step.agentPersona)! })),
    requiredTools: workflow.tools, optionalTools: [],
  }));
  const catalog = [...ENGINEERING_SKILLS, ...PRODUCT_SKILLS, ...HR_SKILLS, ...TA_SKILLS, ...PROGRAM_SKILLS, ...MARKETING_WORKFLOW_REFS, ...flagships].map(definition => compileDefinition(definition));
  if (new Set(catalog.map(definition => definition.id)).size !== catalog.length || new Set(catalog.map(definition => `${definition.persona}:${definition.slug}`)).size !== catalog.length) throw new Error('Duplicate catalog identity');
  return catalog;
}

export function getCompiledDefinition(idOrSlug: string, persona?: WorkflowPersona): CompiledDefinition | undefined {
  const matches = getCompiledCatalog().filter(definition => (definition.id === idOrSlug || definition.slug === idOrSlug) && (!persona || definition.persona === persona));
  if (matches.length > 1) throw new Error('Ambiguous skill slug; provide the persona or stable skill ID');
  return matches[0];
}
