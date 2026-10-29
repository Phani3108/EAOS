/**
 * Adopted community skills (skills/<persona>/<slug>/SKILL.md) as runnable
 * single-step definitions.
 */

import { canonicalPersona, WORKFLOW_PERSONAS, type UnifiedSkillDef, type WorkflowPersona } from '@agentos/skills/schema';
import { primaryWorkflowAgent } from './agent-registry.js';
import type { FSSkillDef } from './skill-fs-loader.js';

/**
 * The workflow persona an adopted skill runs under, or undefined when its
 * folder (design, learning, leadership, ...) has no workflow runtime. Callers
 * refuse those with a 4xx: compileDefinition would reject them anyway, and as
 * an untyped throw that surfaced as a 500.
 */
export function adoptedSkillPersona(fs: Pick<FSSkillDef, 'persona'>): WorkflowPersona | undefined {
    const persona = canonicalPersona(fs.persona);
    return persona && (WORKFLOW_PERSONAS as readonly string[]).includes(persona) ? persona as WorkflowPersona : undefined;
}

/**
 * Adapt an adopted community skill (FSSkillDef) into an executable single-step
 * UnifiedSkillDef. The skill's markdown body is passed separately as the step's
 * instructions (via customPrompt) so the LLM receives the actual skill content.
 *
 * The step runs as the persona's primary agent: SKILL.md files name no agent,
 * and compileDefinition requires a catalog agent for every step, so an empty
 * agent made every adopted run fail at admission.
 */
export function synthesizeAdoptedSkill(fs: FSSkillDef): UnifiedSkillDef | undefined {
    const persona = adoptedSkillPersona(fs);
    if (!persona) return undefined;
    return {
        id: fs.id,
        slug: fs.slug,
        name: fs.name,
        description: fs.description || fs.name,
        icon: '🧩',
        persona,
        executableType: 'skill',
        cluster: fs.cluster ?? 'Adopted Skills',
        complexity: fs.complexity ?? 'moderate',
        estimatedTime: fs.estimatedTime ?? '~varies',
        inputs: [{ id: 'request', label: 'Request / Context', type: 'textarea', required: false, section: 'basic', helpText: 'Optional context or target for this skill.' }],
        steps: [{ id: `${fs.id}-s1`, order: 1, name: fs.name, agent: primaryWorkflowAgent(persona), tool: 'Claude', outputKey: 'result', capability: 'content.generate' }],
        outputs: ['result'],
        requiredTools: ['Claude'],
        optionalTools: fs.requiredTools ?? [],
        tags: fs.tags ?? [],
    };
}
