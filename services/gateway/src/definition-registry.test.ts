import { describe, expect, it } from 'vitest';
import { compileDefinition, getCompiledCatalog } from './definition-registry.js';
import { getAgentIdentity } from './agent-registry.js';
import { ENGINEERING_SKILLS } from './engineering-skills-data.js';
import { ExecuteSchema, validateSkillInputs } from './validation.js';
import { aggregateExecutionStatus, assertExecutionTransition } from '../../../packages/skills/src/schema.js';

describe('canonical execution definitions', () => {
  it('compiles all 81 catalogs and all 311 step identities without losing definitions', () => {
    const catalog = getCompiledCatalog();
    expect(catalog).toHaveLength(81);
    expect(catalog.reduce((count, definition) => count + definition.steps.length, 0)).toBe(311);
    expect(new Set(catalog.map(definition => definition.id)).size).toBe(81);
    for (const definition of catalog) {
      expect(definition.definitionHash).toMatch(/^[a-f0-9]{64}$/);
      expect(definition.schemaVersion).toBe(1);
      for (const step of definition.steps) {
        expect(getAgentIdentity(step.agent)?.id).toBe(step.agent);
        expect(step.toolId).toBeTruthy();
        expect(step.kind).toBeTruthy();
      }
    }
  });
  it('maps misleading flagship labels by responsibility instead of matching callsigns', () => {
    const workflow = getCompiledCatalog().find(definition => definition.id === 'fw-001')!;
    expect(workflow.steps.find(step => step.id === 'fw-001-s3')?.agent).toBe('architecture-reviewer');
    expect(workflow.steps.find(step => step.id === 'fw-001-s1')?.agent).toBe('prd-writer');
  });
  it('rejects unknown identities, output collisions and invalid dependency graphs', () => {
    const definition = structuredClone(ENGINEERING_SKILLS[0]!);
    expect(() => compileDefinition({ ...definition, steps: [{ ...definition.steps[0]!, agent: 'not-an-agent' }] })).toThrow();
    expect(() => compileDefinition({ ...definition, steps: [{ ...definition.steps[0]!, tool: 'not-a-tool' }] })).toThrow();
    expect(() => compileDefinition({ ...definition, steps: [{ ...definition.steps[0]!, dependsOn: ['missing'] }] })).toThrow();
    expect(() => compileDefinition({ ...definition, steps: [{ ...definition.steps[0]!, dependsOn: [definition.steps[0]!.id] }] })).toThrow();
    expect(() => compileDefinition({ ...definition, steps: [definition.steps[0]!, { ...definition.steps[1]!, outputKey: definition.steps[0]!.outputKey }] })).toThrow();
  });
  it('hashes definitions deterministically and changes the hash for behavior changes', () => {
    const definition = structuredClone(ENGINEERING_SKILLS[0]!);
    expect(compileDefinition(definition).definitionHash).toBe(compileDefinition(structuredClone(definition)).definitionHash);
    definition.steps[0]!.requiresApproval = true;
    expect(compileDefinition(definition).definitionHash).not.toBe(compileDefinition(ENGINEERING_SKILLS[0]!).definitionHash);
  });
  it('uses six canonical persona IDs with explicit compatibility aliases only', () => {
    for (const persona of ['engineering', 'product', 'marketing', 'hr', 'ta', 'program']) expect(ExecuteSchema.parse({ persona, skillId: 'fixture' }).persona).toBe(persona);
    expect(ExecuteSchema.parse({ persona: 'talent-acquisition', skillId: 'fixture' }).persona).toBe('ta');
    expect(ExecuteSchema.safeParse({ persona: 'unknown', skillId: 'fixture' }).success).toBe(false);
  });
});

describe('input and outcome contracts', () => {
  it('validates required values, choices and upload references before execution', () => {
    const fields = [
      { id: 'text', label: 'Text', type: 'textarea' as const, required: true, section: 'basic' as const },
      { id: 'choice', label: 'Choice', type: 'select' as const, options: ['a', 'b'], section: 'basic' as const },
      { id: 'files', label: 'Files', type: 'file' as const, multiple: true, section: 'advanced' as const },
    ];
    expect(() => validateSkillInputs(fields, {})).toThrow();
    expect(() => validateSkillInputs(fields, { text: ' ', choice: 'c' })).toThrow();
    expect(() => validateSkillInputs(fields, { text: 'fixture', files: ['/etc/passwd'] })).toThrow();
    expect(validateSkillInputs(fields, { text: 'fixture', choice: 'a', files: [{ artifactId: 'artifact-fixture' }] })).toMatchObject({ text: 'fixture' });
  });
  it.each(['failed', 'rejected', 'cancelled', 'unsupported', 'inconclusive'] as const)('never aggregates %s into completed', status => {
    expect(aggregateExecutionStatus(['completed', status, 'pending'], 'live')).toBe(status);
    expect(() => assertExecutionTransition(status, 'completed')).toThrow();
  });
  it('does not treat pending work or simulation as live success', () => {
    expect(aggregateExecutionStatus(['completed', 'approval_required'], 'live')).toBe('paused');
    expect(aggregateExecutionStatus(['completed', 'pending'], 'live')).toBe('inconclusive');
    expect(aggregateExecutionStatus(['simulated', 'simulated'], 'simulation')).toBe('simulated');
    expect(aggregateExecutionStatus(['simulated'], 'live')).toBe('inconclusive');
    expect(aggregateExecutionStatus([], 'live')).toBe('inconclusive');
    expect(aggregateExecutionStatus(['completed'], 'live')).toBe('completed');
  });
});
