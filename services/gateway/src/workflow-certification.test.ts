import { describe, expect, it } from 'vitest';
import { getCompiledCatalog } from './definition-registry.js';
import { describeWorkflowSupport, inspectStarterYaml } from './workflow-certification.js';
import type { AuthUser } from './auth.js';
const owner: AuthUser = { id: 'fixture', tenantId: 'fixture', name: 'Fixture', email: 'fixture@example.invalid', role: 'admin', teams: [], personaScopes: ['*'] };

describe('workflow certification boundaries', () => {
  it('never converts static compilation into vendor or domain certification', () => {
    const catalog = getCompiledCatalog();
    expect(catalog.length).toBe(81);
    for (const definition of catalog) {
      const support = describeWorkflowSupport(definition);
      expect(support.certification.vendorSandbox).toBe('not-certified');
      expect(support.certification.domainReview).toBe('not-reviewed');
      if (definition.steps.some(step => ['tool_read','tool_effect'].includes(step.kind) && !step.toolAction)) expect(support.readiness).toBe('unsupported-bindings');
    }
  });
  it('compiles known SDK starters and explicitly rejects invented workers', () => {
    const source = 'name: fixture\nsteps:\n  - id: explain\n    worker: code-reviewer\n    action: eng-007\n    input:\n      code_or_module: fixture\n';
    expect(inspectStarterYaml(source, owner)[0]?.status).toBe('compiled');
    expect(inspectStarterYaml(source.replace('code-reviewer', 'unknown-worker'), owner)[0]).toMatchObject({ status: 'unsupported', reason: 'Unknown canonical worker: unknown-worker' });
  });
  it('rejects duplicate YAML keys and oversized documents', () => {
    expect(() => inspectStarterYaml('name: first\nname: second\n', owner)).toThrow();
    expect(() => inspectStarterYaml('x'.repeat(256_001), owner)).toThrow();
  });
});
