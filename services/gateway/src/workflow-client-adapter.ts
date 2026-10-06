import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalPersona, WORKFLOW_PERSONAS, type UnifiedSkillDef, type UnifiedStepDef, type WorkflowPersona } from '@agentos/skills/schema';
import { getAgentIdentity, getAgentsByPersona } from './agent-registry.js';
import { compileDefinition, getCompiledDefinition, requiredPersonas } from './definition-registry.js';
import { requirePersonaAccess, type AuthUser } from './auth.js';
import { validate } from './validation.js';

const identifier = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/);
const retry = z.object({ maxAttempts: z.number().int().min(1).max(6), backoff: z.enum(['fixed','linear','exponential']), initialDelayMs: z.number().min(0).max(60_000) });
export function compileClientRequest(principal: AuthUser, body: unknown) {
    const input = validate(z.object({ format: z.enum(['sdk','workflow-engine']), workflow: z.unknown(), variables: z.unknown().optional(), simulate: z.boolean().default(false) }).strict(), body);
    let persona: WorkflowPersona;
    let name: string;
    let steps: UnifiedStepDef[] = [];
    let edges: UnifiedSkillDef['edges'];
    let variables: Record<string, unknown>;
    let deadline: number | undefined;
    let priority = 'normal';
    const actor = (scope: WorkflowPersona) => scope === 'program' ? 'pmo-director' : getAgentsByPersona(scope === 'ta' ? 'hr' : scope)[0]!.id;
    if (input.format === 'sdk') {
        const workflow = validate(z.object({ name: z.string().min(1).max(200), description: z.string().max(4000), version: z.string().min(1).max(100), trigger: z.object({ event: z.string(), filter: z.string().optional() }), timeoutMs: z.number().int().min(1000).max(604_800_000).optional(), priority: z.enum(['low','normal','high','critical']), retry: retry.optional(), onFailure: z.array(z.unknown()).max(0).optional(), onSuccess: z.array(z.unknown()).max(0).optional(), steps: z.array(z.object({ id: identifier, name: z.string().max(240), worker: z.string().min(1), action: z.string().optional(), dependsOn: z.array(identifier).default([]), condition: z.string().max(4000).optional(), input: z.record(z.string(), z.unknown()).default({}), output: z.array(z.string()).optional(), timeoutMs: z.number().int().min(1).max(86_400_000).optional(), retry: retry.optional(), approval: z.object({ required: z.boolean(), approvers: z.array(z.string()), timeoutMinutes: z.number().positive().max(10_080), escalation: z.string().optional() }).optional() }).strict()).min(1).max(100) }).strict(), input.workflow);
        name = workflow.name; priority = workflow.priority; deadline = workflow.timeoutMs;
        const first = getAgentIdentity(workflow.steps[0]!.worker);
        const resolved = first?.id === 'pmo-director' ? 'program' : first?.persona;
        if (!resolved || !(WORKFLOW_PERSONAS as readonly string[]).includes(resolved)) throw new Error('SDK worker is not a canonical persona agent');
        persona = resolved as WorkflowPersona;
        variables = { trigger: input.variables ?? {}, variables: {} };
        for (const step of workflow.steps) {
            const identity = getAgentIdentity(step.worker);
            const scope = identity?.id === 'pmo-director' ? 'program' : identity?.persona;
            if (!identity || !scope || !(WORKFLOW_PERSONAS as readonly string[]).includes(scope)) throw new Error('Unknown SDK worker');
            const definition = step.action ? getCompiledDefinition(step.action, scope as WorkflowPersona) : undefined;
            if (step.action && !definition) throw new Error('SDK actions must reference canonical skills');
            let dependencies = step.dependsOn;
            const gate = `${step.id}_approval`;
            if (step.condition) {
                const condition = `${step.id}_condition`, skip = `${step.id}_skip`;
                steps.push({ id: condition, order: steps.length + 1, name: 'SDK step condition', agent: identity.id, agentPersona: scope, kind: 'condition', outputKey: condition, dependsOn: dependencies, condition: { expression: step.condition, trueStep: step.approval?.required ? gate : step.id, falseStep: skip } });
                steps.push({ id: skip, order: steps.length + 1, name: 'SDK condition not met', agent: identity.id, agentPersona: scope, kind: 'transform', outputKey: skip, dependsOn: [condition], transform: { skipped: true } });
                dependencies = [condition];
            }
            if (step.approval?.required) {
                steps.push({ id: gate, order: steps.length + 1, name: `Approve ${step.name}`, agent: identity.id, agentPersona: scope, kind: 'approval', approvalApprovers: step.approval.approvers, approvalTimeoutMs: Math.ceil(step.approval.timeoutMinutes * 60_000), outputKey: gate, dependsOn: dependencies });
                dependencies = [gate];
            }
            const policy = step.retry ?? workflow.retry;
            steps.push({ id: step.id, order: steps.length + 1, name: step.name, agent: identity.id, agentPersona: scope, kind: definition ? 'subworkflow' : 'llm', subworkflow: definition ? { definition } : undefined, outputKey: step.id, dependsOn: dependencies, inputBindings: step.input, timeoutMs: step.timeoutMs, retry: policy ? { maxAttempts: policy.maxAttempts, backoffMs: policy.initialDelayMs, strategy: policy.backoff } : undefined });
        }
    } else {
        const workflow = validate(z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200), description: z.string().max(4000), version: z.string().min(1).max(100), variables: z.record(z.string(), z.unknown()).default({}), metadata: z.object({ domain: z.string() }).passthrough(), triggers: z.array(z.unknown()).max(100), template: z.unknown().optional(), edges: z.array(z.object({ from: identifier, to: identifier, condition: z.string().max(4000).optional() })).max(1000), steps: z.array(z.object({ id: identifier, name: z.string().max(240), type: z.enum(['skill','tool','approval','condition','parallel','sub_workflow','transform']), config: z.record(z.string(), z.unknown()), retry: z.object({ maxAttempts: z.number().int().min(1).max(6), backoffMs: z.number().min(0).max(60_000) }), timeoutMs: z.number().int().min(1).max(86_400_000), onError: z.enum(['fail','retry','skip','fallback']), fallbackStepId: identifier.optional() }).strict()).min(1).max(100) }).strict(), input.workflow);
        const scope = canonicalPersona(workflow.metadata.domain);
        if (!scope || !(WORKFLOW_PERSONAS as readonly string[]).includes(scope)) throw new Error('Unknown workflow persona');
        persona = scope as WorkflowPersona; name = workflow.name;
        variables = { variables: input.variables ?? workflow.variables, trigger: {} };
        const qualify = (expression: string) => workflow.steps.reduce((text, step) => text.replace(new RegExp(`\\b${step.id.replace(/[-]/g, '\\-')}_output\\b`, 'g'), `steps.${step.id}.output`), expression);
        edges = workflow.edges.map(edge => ({ ...edge, condition: edge.condition ? qualify(edge.condition) : undefined }));
        for (const step of workflow.steps) {
            if (step.type !== step.config.type) throw new Error('Workflow node type and config differ');
            if (step.onError === 'skip' || step.onError === 'fallback') throw new Error('Implicit failure skipping/fallback is not a canonical contract');
            const base: UnifiedStepDef = { id: step.id, order: steps.length + 1, name: step.name, agent: actor(persona), agentPersona: persona, outputKey: step.id, dependsOn: edges.filter(edge => edge.to === step.id).map(edge => edge.from), timeoutMs: step.timeoutMs, retry: step.onError === 'retry' ? step.retry : undefined };
            if (step.type === 'skill' || step.type === 'sub_workflow') {
                const ref = step.type === 'skill' ? step.config.skillId : step.config.workflowId;
                if (typeof ref !== 'string') throw new Error('Canonical workflow reference required');
                const child = getCompiledDefinition(ref, persona);
                if (!child) throw new Error('Unknown canonical workflow reference');
                steps.push({ ...base, kind: 'subworkflow', subworkflow: { definition: child }, inputBindings: z.record(z.string(), z.unknown()).parse(step.config.inputs) });
            } else if (step.type === 'condition') {
                const config = z.object({ expression: z.string().max(4000), trueEdge: identifier, falseEdge: identifier }).parse(step.config);
                steps.push({ ...base, kind: 'condition', condition: { expression: qualify(config.expression), trueStep: config.trueEdge, falseStep: config.falseEdge } });
            } else if (step.type === 'parallel') {
                const dependencies = z.array(identifier).min(1).max(100).parse(step.config.stepIds);
                steps.push({ ...base, kind: 'join', dependsOn: [...new Set([...base.dependsOn!, ...dependencies])] });
            } else if (step.type === 'approval') steps.push({ ...base, kind: 'approval' });
            else if (step.type === 'transform') steps.push({ ...base, kind: 'transform', transformExpression: qualify(z.string().max(4000).parse(step.config.expression)) });
            else {
                const config = z.object({ toolId: z.string(), params: z.object({ action: z.string(), resourceType: z.string(), inputBindings: z.record(z.string(), z.string()) }).strict() }).parse(step.config);
                steps.push({ ...base, kind: ['read','search','list','fetch_metadata'].includes(config.params.action) ? 'tool_read' : 'tool_effect', tool: config.toolId, toolAction: config.params });
            }
        }
    }
    const raw: UnifiedSkillDef = { id: `client-${createHash('sha256').update(JSON.stringify(input.workflow)).digest('hex').slice(0,24)}`, slug: 'client-workflow', name, description: 'Canonical client workflow', icon: '', persona, executableType: 'workflow', cluster: 'SDK', complexity: 'complex', estimatedTime: '', inputs: [], steps, edges, outputs: steps.filter(step => !step.id.endsWith('_condition') && !step.id.endsWith('_skip') && !step.id.endsWith('_approval')).map(step => step.outputKey), requiredTools: [], optionalTools: [], tags: [input.format], executionMode: 'dag' };
    const definition = compileDefinition(raw);
    if (requiredPersonas(definition).some(persona => !requirePersonaAccess(principal, persona))) throw Object.assign(new Error('Workflow persona permission denied'), { statusCode: 403 });
    return { definition, inputs: variables, simulate: input.simulate, source: { type: input.format, label: name, priority, ...(deadline ? { globalTimeoutMs: deadline } : {}) } };
}
