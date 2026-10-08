import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalPersona, WORKFLOW_PERSONAS, type UnifiedSkillDef, type UnifiedStepDef, type WorkflowPersona } from '@agentos/skills/schema';
import { compileDefinition, compileTaskPlan, getCompiledCatalog, requiredPersonas, type CompiledDefinition } from './definition-registry.js';
import { getAgentIdentity, primaryWorkflowAgent } from './agent-registry.js';
import { requirePersonaAccess, type AuthUser } from './auth.js';
import { validate } from './validation.js';
import { SWARM_TEMPLATES } from './swarm-manager.js';
import { resolveSimulate } from './run-mode.js';

export interface EntrypointAdmission {
    definition: CompiledDefinition;
    inputs: Record<string, unknown>;
    /** The client's choice, undefined when it made none; the runtime decides the mode (run-mode.ts). */
    simulate?: boolean;
    provider?: 'anthropic' | 'openai' | 'azure-openai' | 'gemini' | 'ollama';
    modelId?: string;
    source: { type: 'goal' | 'soman' | 'swarm'; label: string; [key: string]: unknown };
}
const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/);
// No default for `simulate`: defaulting a missing field to false made every
// pipeline and swarm launched from the UI (which sends none) a live run, even on
// a gateway with no LLM provider. A missing field is "no choice", and the
// runtime decides.
const common = { simulate: z.boolean().optional(), persona: z.enum(WORKFLOW_PERSONAS).optional(), provider: z.enum(['anthropic','openai','azure-openai','gemini','ollama']).optional(), model: z.string().max(200).optional() };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
function permitted(principal: AuthUser, definition: CompiledDefinition): void {
    if (!principal.tenantId || !principal.id || requiredPersonas(definition).some(persona => !requirePersonaAccess(principal, persona))) throw Object.assign(new Error('Entrypoint requires additional persona permissions'), { statusCode: 403 });
}
function definition(name: string, persona: WorkflowPersona, steps: UnifiedStepDef[], outputs = steps.map(step => step.outputKey)): UnifiedSkillDef {
    return { id: `entry-${hash([name,steps])}`, slug: 'canonical-entrypoint', name, description: name, icon: '', persona, executableType: 'workflow', cluster: 'Orchestration', complexity: 'complex', estimatedTime: '', executionMode: 'dag', inputs: [], steps, outputs, requiredTools: [], optionalTools: [], tags: ['canonical-adapter'] };
}

export function compileGoalRequest(principal: AuthUser, body: unknown): EntrypointAdmission {
    const input = validate(z.object({ ...common, description: z.string().trim().min(1).max(20_000), context: z.record(z.string(), z.unknown()).default({}), priority: z.enum(['low','normal','high','critical']).default('normal'), plan: z.unknown().optional() }).strict(), body);
    const persona = input.persona ?? (typeof input.context.persona === 'string' ? canonicalPersona(input.context.persona) as WorkflowPersona | undefined : undefined) ?? 'engineering';
    if (!(WORKFLOW_PERSONAS as readonly string[]).includes(persona)) throw new Error('Unsupported goal persona');
    const candidates = getCompiledCatalog().filter(candidate => requiredPersonas(candidate).every(value => requirePersonaAccess(principal, value)));
    const suppliedPlan = input.plan ?? input.context.plan;
    let compiled: CompiledDefinition;
    if (suppliedPlan !== undefined) compiled = compileTaskPlan(suppliedPlan, candidates, persona);
    else {
        // Planning needs a live model, so the run's mode must be known here — the
        // same decision the runtime will make — to refuse a plan-less goal that
        // would be simulated instead of admitting a run that cannot succeed.
        if (resolveSimulate(principal.id, input.simulate)) throw Object.assign(new Error(input.simulate === true ? 'Simulated goals require an explicit task plan' : 'This goal would run as a simulation (demo session or no LLM provider configured), and simulated goals require an explicit task plan'), { statusCode: 422 });
        if (!candidates.length) throw new Error('No authorized planning candidates');
        compiled = compileDefinition(definition('Goal planning and execution', persona, [{ id: 'plan', order: 1, name: 'Compile and execute goal plan', agent: primaryWorkflowAgent(persona), agentPersona: persona, kind: 'planner', outputKey: 'result', planCandidates: candidates }]));
    }
    permitted(principal, compiled);
    return { definition: compiled, inputs: { goal: input.description, context: input.context }, simulate: input.simulate, provider: input.provider, modelId: input.model, source: { type: 'goal', label: input.description, priority: input.priority } };
}

const SOMAN_AGENTS: Record<string, string> = {
    'marketing.research': 'brand-strategist', 'marketing.competitor': 'brand-strategist', 'marketing.seo': 'seo-analyst',
    'marketing.strategy': 'marketing-director', 'marketing.copy': 'content-strategist', 'marketing.design': 'creative-lead',
    'marketing.landing': 'content-strategist', 'marketing.email': 'content-strategist', 'marketing.campaign': 'campaign-manager',
    'marketing.analytics': 'analytics-assistant', 'marketing.optimization': 'seo-analyst',
};
const graphSchema = z.object({
    graph_id: z.string().min(1).max(200), name: z.string().max(240).default('Agent graph'), description: z.string().max(20_000).optional(),
    nodes: z.array(z.object({ id, agent: z.string().min(1).max(200), depends_on: z.array(id).max(100), phase: z.string().max(100), parallel_group: z.string().nullable().optional(), kind: z.enum(['llm','transform','condition','join','wait','tool_read','tool_effect']).optional(), transform: z.record(z.string(), z.unknown()).optional(), condition: z.object({ expression: z.string().max(4000), trueStep: id, falseStep: id }).optional(), waitMs: z.number().int().min(0).max(604_800_000).optional(), tool: z.string().optional(), toolAction: z.object({ action: z.string(), resourceType: z.string(), inputBindings: z.record(z.string(), z.string()) }).optional() }).strict()).min(1).max(100),
    phases: z.record(z.string(), z.unknown()).default({}),
    quality_gates: z.array(z.object({ id, after_node: id, type: z.string().optional(), validation: z.record(z.string(), z.unknown()).default({}), on_fail: z.enum(['retry','block','skip']).default('block'), max_retries: z.number().int().min(0).max(5).optional(), retry_instructions: z.string().max(4000).optional(), escalation: z.string().max(4000).optional() }).strict()).max(100).default([]),
    checkpoints: z.array(z.object({ id, before_node: id.optional(), within_node: id.optional(), after_gate: id.optional(), type: z.enum(['human_approval','conditional_approval']), description: z.string().max(4000), condition: z.string().max(4000).optional(), auto_approve_below: z.number().optional(), timeout_hours: z.number().positive().max(168).optional(), on_timeout: z.string().optional(), escalation_target: z.string().optional(), requires_fields: z.array(z.string()).optional() }).strict()).max(100).default([]),
    shared_state: z.record(z.string(), z.object({ written_by: id, read_by: z.array(id), schema: z.string().optional() })).default({}),
    feedback_loops: z.array(z.object({ id, from: id, to: z.array(id).min(1).max(100), trigger: z.object({ condition: id, thresholds: z.record(z.string(), z.number()).default({}), minimum_data_window_hours: z.number().min(0).max(168).optional() }).strict(), actions: z.record(z.string(), z.string()).default({}), max_loop_iterations: z.number().int().min(1).max(5), cooldown_hours: z.number().min(0).max(168), circuit_breaker: z.unknown().optional() }).strict()).max(5).default([]),
    execution_config: z.object({ parallel_execution: z.boolean(), max_concurrent_agents: z.number().int().min(1).max(16), global_timeout_minutes: z.number().positive().max(1440), per_node_timeout_minutes: z.number().positive().max(1440), retry_backoff_multiplier: z.number().min(1).max(10), status_reporting_interval_seconds: z.number().positive().max(3600) }).optional(),
}).passthrough();

export function compileSomanRequest(principal: AuthUser, body: unknown): EntrypointAdmission {
    const input = validate(z.object({ ...common, intent: z.string().trim().min(1).max(20_000), context: z.record(z.string(), z.unknown()).default({}), graphConfig: graphSchema, orchestratorConfig: z.record(z.string(), z.unknown()).optional(), agentDefinitions: z.array(z.object({ agent_id: z.string(), name: z.string().optional(), system_prompt: z.string().max(20_000).optional() }).passthrough()).max(100).optional() }).strict(), body);
    const graph = input.graphConfig;
    const persona = input.persona ?? (graph.graph_id.startsWith('marketing.') ? 'marketing' : 'engineering');
    const ids = new Set(graph.nodes.map(node => node.id));
    const agents = new Map(graph.nodes.map(node => {
        const canonical = SOMAN_AGENTS[node.agent] ?? node.agent;
        const identity = getAgentIdentity(canonical);
        if (!identity || !(identity.persona === persona || persona === 'ta' && identity.persona === 'hr' || persona === 'program' && identity.id === 'pmo-director')) throw new Error(`Unknown or out-of-persona graph agent: ${node.agent}`);
        return [node.id, canonical];
    }));
    for (const supplied of input.agentDefinitions ?? []) if (!graph.nodes.some(node => node.agent === supplied.agent_id) || !getAgentIdentity(SOMAN_AGENTS[supplied.agent_id] ?? supplied.agent_id)) throw new Error('Agent definition is outside the canonical graph');
    for (const item of Object.values(graph.shared_state)) if (!ids.has(item.written_by) || item.read_by.some(reader => !ids.has(reader))) throw new Error('Shared-state reference is outside the graph');
    for (const gate of graph.quality_gates) if (!ids.has(gate.after_node)) throw new Error('Quality gate references an unknown node');
    for (const checkpoint of graph.checkpoints) if (!(checkpoint.before_node || checkpoint.within_node) || !ids.has((checkpoint.before_node ?? checkpoint.within_node)!)) throw new Error('Checkpoint references an unknown node');
    const feedbackPairs = new Set(graph.feedback_loops.flatMap(loop => loop.to.map(target => `${loop.from}:${target}`)));
    const build = (selected: Set<string>, suffix: string, forceLast?: string): UnifiedSkillDef => {
        const steps: UnifiedStepDef[] = [];
        for (const node of graph.nodes.filter(node => selected.has(node.id))) {
            const dependencies = new Set(node.depends_on.filter(dep => selected.has(dep)));
            for (const state of Object.values(graph.shared_state)) if (state.read_by.includes(node.id) && selected.has(state.written_by) && state.written_by !== node.id && !feedbackPairs.has(`${state.written_by}:${node.id}`)) dependencies.add(state.written_by);
            if (node.id === forceLast) for (const other of selected) if (other !== node.id) dependencies.add(other);
            const stateBindings = Object.fromEntries(Object.entries(graph.shared_state).filter(([, state]) => state.read_by.includes(node.id)).map(([key, state]) => [key.replace(/^state\./, ''), { $ref: selected.has(state.written_by) && !feedbackPairs.has(`${state.written_by}:${node.id}`) ? `steps.${state.written_by}.output` : `inputs.prior.${state.written_by}` }]));
            const requirements = graph.quality_gates.filter(gate => gate.after_node === node.id);
            const sections = requirements.flatMap(gate => Array.isArray(gate.validation.required_sections) ? gate.validation.required_sections.filter((value): value is string => typeof value === 'string') : []);
            const minCitations = Math.max(0, ...requirements.map(gate => typeof gate.validation.min_citations === 'number' ? gate.validation.min_citations : 0));
            for (const checkpoint of graph.checkpoints.filter(checkpoint => (checkpoint.before_node ?? checkpoint.within_node) === node.id)) {
                const gateId = `gate_${checkpoint.id}`;
                if (steps.some(step => step.id === gateId)) throw new Error('Duplicate checkpoint identity');
                if (checkpoint.type === 'conditional_approval') {
                    const match = checkpoint.condition?.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(>=|<=|>|<|===|!==)\s*(-?\d+(?:\.\d+)?)$/);
                    if (!match) throw new Error('Conditional approval requires a bounded numeric comparison');
                    const choose = `${gateId}_when`, skip = `${gateId}_skip`, merge = `${gateId}_join`;
                    steps.push({ id: choose, order: steps.length + 1, name: 'Check approval threshold', agent: agents.get(node.id)!, agentPersona: persona, kind: 'condition', outputKey: choose, dependsOn: [...dependencies], condition: { expression: `inputs.context.${match[1]} === undefined || inputs.context.${match[1]} ${match[2]} ${match[3]}`, trueStep: gateId, falseStep: skip } });
                    steps.push({ id: gateId, order: steps.length + 1, name: checkpoint.description, agent: agents.get(node.id)!, agentPersona: persona, kind: 'approval', approvalFields: checkpoint.requires_fields, approvalTimeoutMs: checkpoint.timeout_hours ? Math.ceil(checkpoint.timeout_hours * 3_600_000) : undefined, outputKey: gateId, dependsOn: [choose] });
                    steps.push({ id: skip, order: steps.length + 1, name: 'Within approved threshold', agent: agents.get(node.id)!, agentPersona: persona, kind: 'transform', outputKey: skip, dependsOn: [choose], transform: { withinThreshold: true } });
                    steps.push({ id: merge, order: steps.length + 1, name: 'Approval threshold join', agent: agents.get(node.id)!, agentPersona: persona, kind: 'join', outputKey: merge, dependsOn: [gateId, skip] });
                    dependencies.add(merge);
                } else {
                    steps.push({ id: gateId, order: steps.length + 1, name: checkpoint.description, agent: agents.get(node.id)!, agentPersona: persona, kind: 'approval', approvalFields: checkpoint.requires_fields, approvalTimeoutMs: checkpoint.timeout_hours ? Math.ceil(checkpoint.timeout_hours * 3_600_000) : undefined, outputKey: gateId, dependsOn: [...dependencies] });
                    dependencies.add(gateId);
                }
            }
            const task = input.agentDefinitions?.find(agent => agent.agent_id === node.agent)?.system_prompt;
            steps.push({ id: node.id, order: steps.length + 1, name: node.id, agent: agents.get(node.id)!, agentLabel: node.agent, agentPersona: persona,
                kind: node.kind ?? 'llm', tool: node.tool ?? 'llm', toolAction: node.toolAction, transform: node.transform, condition: node.condition, waitMs: node.waitMs,
                outputKey: node.id, dependsOn: [...dependencies], inputBindings: { intent: { $ref: 'inputs.intent' }, context: { $ref: 'inputs.context' }, state: stateBindings, dependencies: Object.fromEntries([...new Set([...node.depends_on, ...(node.id === forceLast ? [...selected].filter(id => id !== node.id) : [])])].map(id => [id, { $ref: selected.has(id) ? `steps.${id}.output` : `inputs.prior.${id}` }])) },
                timeoutMs: Math.ceil((graph.execution_config?.per_node_timeout_minutes ?? 15) * 60_000),
                taskPrompt: task, outputRequirements: sections.length || minCitations ? { sections, minCitations } : undefined,
                retry: requirements.some(gate => gate.on_fail === 'retry') ? { maxAttempts: Math.max(...requirements.filter(gate => gate.on_fail === 'retry').map(gate => (gate.max_retries ?? 0) + 1)), backoffMs: 1000 } : undefined,
                requiresApproval: requirements.some(gate => gate.type === 'human_approval' || Object.keys(gate.validation).some(key => !['required_sections','min_citations'].includes(key))),
            });
        }
        const raw = definition(`${graph.name}${suffix}`, persona, steps, graph.nodes.filter(node => selected.has(node.id)).map(node => node.id));
        raw.maxConcurrency = graph.execution_config?.parallel_execution === false ? 1 : graph.execution_config?.max_concurrent_agents ?? 4;
        return raw;
    };
    for (const node of graph.nodes) if (node.depends_on.some(dep => !ids.has(dep))) throw new Error('Graph dependency is missing');
    const raw = build(ids, '');
    for (const loop of graph.feedback_loops) {
        if (!ids.has(loop.from) || loop.to.some(target => !ids.has(target) || target === loop.from)) throw new Error('Feedback loop references an unknown target');
        let previous = loop.from;
        let previousResult = loop.from;
        for (let iteration = 0; iteration < loop.max_loop_iterations; iteration++) {
            const key = `loop_${loop.id}_${iteration}`;
            const choose = `${key}_choose`, wait = `${key}_wait`, bypass = `${key}_skip`, merge = `${key}_merge`, guard = `${key}_guard`;
            const flag = `steps.${previousResult}.output.${iteration === 0 ? '' : `${loop.from}.`}${loop.trigger.condition}`;
            raw.steps.push({ id: choose, order: raw.steps.length + 1, name: 'Evaluate feedback trigger', agent: agents.get(loop.from)!, agentPersona: persona, kind: 'condition', outputKey: choose, dependsOn: iteration === 0 ? [...ids] : [previous], condition: { expression: `${flag} === true${iteration === 0 ? ` || inputs.context.${loop.trigger.condition} === true` : ''}`, trueStep: loop.circuit_breaker ? guard : wait, falseStep: bypass } });
            if (loop.circuit_breaker) raw.steps.push({ id: guard, order: raw.steps.length + 1, name: 'Review feedback circuit breaker before continuation', agent: agents.get(loop.from)!, agentPersona: persona, kind: 'approval', outputKey: guard, dependsOn: [choose], taskPrompt: JSON.stringify(loop.circuit_breaker) });
            raw.steps.push({ id: wait, order: raw.steps.length + 1, name: 'Feedback measurement/cooldown wait', agent: agents.get(loop.from)!, agentPersona: persona, kind: 'wait', outputKey: wait, dependsOn: [loop.circuit_breaker ? guard : choose], waitMs: Math.max(loop.cooldown_hours, loop.trigger.minimum_data_window_hours ?? 0) * 3_600_000 });
            const nested = build(new Set([...loop.to, loop.from]), ` feedback ${loop.id}/${iteration}`, loop.from);
            raw.steps.push({ id: key, order: raw.steps.length + 1, name: `Feedback ${loop.id}/${iteration}`, agent: agents.get(loop.from)!, agentPersona: persona, kind: 'subworkflow', outputKey: key, dependsOn: [wait], inputBindings: { intent: { $ref: 'inputs.intent' }, context: { $ref: 'inputs.context' }, prior: Object.fromEntries([...ids].map(id => [id, { $ref: iteration > 0 && [...loop.to, loop.from].includes(id) ? `steps.${previousResult}.output.${id}` : `steps.${id}.output` }])) }, subworkflow: { definition: nested } });
            raw.steps.push({ id: bypass, order: raw.steps.length + 1, name: 'Feedback not triggered', agent: agents.get(loop.from)!, agentPersona: persona, kind: 'transform', outputKey: bypass, dependsOn: [choose], transform: { triggered: false } });
            raw.steps.push({ id: merge, order: raw.steps.length + 1, name: 'Feedback merge', agent: agents.get(loop.from)!, agentPersona: persona, kind: 'join', outputKey: merge, dependsOn: [key, bypass] });
            previous = merge;
            previousResult = key;
        }
    }
    const compiled = compileDefinition(raw);
    permitted(principal, compiled);
    return { definition: compiled, inputs: { intent: input.intent, context: input.context, prior: Object.fromEntries([...ids].map(id => [id, null])) }, simulate: input.simulate, provider: input.provider, modelId: input.model, source: { type: 'soman', label: input.intent, graphId: graph.graph_id, stateBindings: graph.shared_state, globalTimeoutMs: Math.ceil((graph.execution_config?.global_timeout_minutes ?? 120) * 60_000), timeoutMs: Math.ceil((graph.execution_config?.per_node_timeout_minutes ?? 15) * 60_000) } };
}

const SWARM_ROLES: Record<string, string[]> = {
    product_launch: ['prd-writer','tech-lead','campaign-manager','pmo-director'],
    incident_response: ['engineering-director','debug-specialist','pmo-director','devops-agent'],
    hiring_sprint: ['ta-lead','jd-drafter','code-reviewer','product-strategist'],
    campaign_pod: ['marketing-director','content-strategist','analytics-assistant','product-strategist'],
};
export function compileSwarmRequest(principal: AuthUser, body: unknown): EntrypointAdmission {
    const input = validate(z.object({ ...common, type: z.string().max(100), mission: z.string().trim().min(1).max(20_000), customAgents: z.array(z.object({ agent_id: z.string() }).passthrough()).max(12).optional(), agents: z.array(z.object({ agent_id: z.string() }).passthrough()).max(12).optional(), context: z.record(z.string(), z.unknown()).default({}), task_ref: z.string().optional() }).strict(), body);
    const template = SWARM_TEMPLATES.find(template => template.type === input.type);
    if (!template) throw new Error('Unknown swarm template');
    const selected = input.customAgents ?? input.agents;
    const actorIds = selected ? selected.map(agent => agent.agent_id) : SWARM_ROLES[input.type] ?? [];
    if (!actorIds.length || actorIds.some(id => !getAgentIdentity(id))) throw new Error('Swarm requires known canonical agents');
    const actors = actorIds.map(id => getAgentIdentity(id)!);
    const personaFor = (id: string): WorkflowPersona => id === 'pmo-director' ? 'program' : getAgentIdentity(id)!.persona as WorkflowPersona;
    if (actors.some(agent => !(WORKFLOW_PERSONAS as readonly string[]).includes(personaFor(agent.id)))) throw new Error('Unsupported swarm persona');
    const persona = input.persona ?? personaFor(actors[0]!.id);
    const steps: UnifiedStepDef[] = [];
    let previous: string | undefined;
    for (let index = 0; index < template.phases.length; index++) {
        const phase = template.phases[index]!;
        const phaseActors = actors.filter(agent => !phase.agents.length || phase.agents.some(value => canonicalPersona(value) === personaFor(agent.id)));
        if (!phaseActors.length) throw new Error(`Swarm phase ${phase.name} has no assigned canonical agent`);
        const gate = `phase_${index}_approval`, id = `phase_${index}`;
        steps.push({ id: gate, order: steps.length + 1, name: `Authorize ${phase.name}`, agent: phaseActors[0]!.id, agentPersona: personaFor(phaseActors[0]!.id), kind: 'approval', outputKey: gate, dependsOn: previous ? [previous] : [] });
        const childSteps: UnifiedStepDef[] = phaseActors.map((agent, actorIndex) => ({ id: `actor_${actorIndex}`, order: actorIndex + 1, name: `${phase.name}: ${agent.role}`, agent: agent.id, agentPersona: personaFor(agent.id), kind: 'llm', tool: 'llm', outputKey: agent.id, dependsOn: [], taskPrompt: phase.description, inputBindings: { mission: { $ref: 'inputs.mission' }, context: { $ref: 'inputs.context' }, priorPhase: { $ref: 'inputs.priorPhase' } } }));
        const child = definition(`${template.name}: ${phase.name}`, personaFor(phaseActors[0]!.id), childSteps);
        child.edges = [];
        if (childSteps.length > 1) {
            const start: UnifiedStepDef = { id: 'start', order: 0, name: 'Phase input', agent: phaseActors[0]!.id, agentPersona: personaFor(phaseActors[0]!.id), kind: 'transform', outputKey: 'phaseInput', transform: { ready: true }, dependsOn: [] };
            child.steps = [start, ...childSteps.map(step => ({ ...step, dependsOn: ['start'] }))];
        }
        steps.push({ id, order: steps.length + 1, name: phase.name, agent: phaseActors[0]!.id, agentPersona: personaFor(phaseActors[0]!.id), kind: 'subworkflow', outputKey: id, dependsOn: [gate], inputBindings: { mission: { $ref: 'inputs.mission' }, context: { $ref: 'inputs.context' }, priorPhase: previous ? { $ref: `steps.${previous}.output` } : {} }, subworkflow: { definition: child } });
        previous = id;
    }
    const compiled = compileDefinition(definition(template.name, persona, steps, steps.filter(step => step.kind === 'subworkflow').map(step => step.outputKey)));
    permitted(principal, compiled);
    return { definition: compiled, inputs: { mission: input.mission, context: input.context }, simulate: input.simulate, provider: input.provider, modelId: input.model, source: { type: 'swarm', label: input.mission, priority: input.type === 'incident_response' ? 'critical' : 'normal', templateType: input.type, phases: template.phases.map(phase => phase.name), agents: actors.map(agent => ({ id: agent.id, agent_id: agent.id, name: agent.callSign, persona: personaFor(agent.id), regiment: agent.regiment, rank: agent.rank })) } };
}
