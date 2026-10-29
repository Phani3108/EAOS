/**
 * Adopted SKILL.md skills must be admissible runs.
 *
 * The synthesized step used to carry agent '', which compileDefinition rejects
 * ("Unknown agent  in ..."), and that untyped throw became a 500 on both
 * /api/skills/fs/execute and the /api/execute adopted fallback, so no adopted
 * skill could ever run. Skills under folders with no workflow runtime
 * (design, learning, leadership) failed the same way.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./task-queue.js', () => ({ enqueue: vi.fn(value => value) }));
vi.mock('./event-bus.js', () => ({ eventBus: { emit: vi.fn(async () => {}) } }));
vi.mock('./agent-memory.js', () => ({ buildAgentMemoryContext: () => '', extractAndStoreMemory: vi.fn(), initAgentMemory: async () => {} }));

import { adoptedSkillPersona, synthesizeAdoptedSkill } from './adopted-skills.js';
import { getAllFsSkills, warmAllFsSkills, type FSSkillDef } from './skill-fs-loader.js';
import { preparePersonaExecution } from './persona-api.js';

const tenantId = 'tenant-fixture';
const userId = 'user-fixture';

let adopted: FSSkillDef[];
beforeAll(() => { warmAllFsSkills(); adopted = getAllFsSkills(); });

describe('synthesizeAdoptedSkill', () => {
  it('admits every adopted skill in a workflow persona folder as a run of that persona', () => {
    const runnable = adopted.filter(skill => adoptedSkillPersona(skill));
    expect(runnable.length).toBeGreaterThan(0);
    for (const fsSkill of runnable) {
      const persona = adoptedSkillPersona(fsSkill)!;
      const { exec, definition } = preparePersonaExecution(tenantId, persona, synthesizeAdoptedSkill(fsSkill)!, { request: 'fixture' }, userId, true, fsSkill.systemPrompt);
      expect(exec.persona).toBe(persona);
      expect(exec.mode).toBe('simulation');
      expect(definition.steps).toHaveLength(1);
      expect(definition.steps[0]!.agent).not.toBe('');
    }
  });

  it('runs each workflow persona as a catalog agent of that persona', () => {
    for (const persona of ['engineering', 'product', 'marketing', 'hr', 'ta', 'program'] as const) {
      const skill = synthesizeAdoptedSkill({ id: `fixture-${persona}`, slug: 'fixture', name: 'Fixture', description: '', persona });
      expect(() => preparePersonaExecution(tenantId, persona, skill!, {}, userId, true)).not.toThrow();
    }
  });

  it('refuses folders that have no workflow runtime instead of synthesizing an uncompilable run', () => {
    for (const persona of ['design', 'learning', 'leadership', 'unknown']) {
      expect(adoptedSkillPersona({ persona })).toBeUndefined();
      expect(synthesizeAdoptedSkill({ id: 'fixture', slug: 'fixture', name: 'Fixture', description: '', persona })).toBeUndefined();
    }
  });
});

describe('preparePersonaExecution', () => {
  it('refuses an uncompilable definition as 422, not an internal error', () => {
    const skill = { ...synthesizeAdoptedSkill({ id: 'fixture', slug: 'fixture', name: 'Fixture', description: '', persona: 'engineering' })! };
    skill.steps = [{ ...skill.steps[0]!, agent: '' }];
    expect(() => preparePersonaExecution(tenantId, 'engineering', skill, {}, userId, true)).toThrow(expect.objectContaining({ statusCode: 422 }));
  });

  it('refuses a definition run under another persona as 422', () => {
    const skill = synthesizeAdoptedSkill({ id: 'fixture', slug: 'fixture', name: 'Fixture', description: '', persona: 'engineering' })!;
    expect(() => preparePersonaExecution(tenantId, 'product', skill, {}, userId, true)).toThrow(expect.objectContaining({ statusCode: 422 }));
  });
});
