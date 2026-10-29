import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { AuthUser } from './auth.js';
import { compileGoalRequest, compileSomanRequest, compileSwarmRequest } from './entrypoint-adapters.js';
import { compileDefinition, getCompiledDefinition, requiredPersonas } from './definition-registry.js';
import type { UnifiedSkillDef } from '@agentos/skills/schema';

const owner: AuthUser = { id: 'fixture', tenantId: 'tenant-a', name: 'Fixture', email: 'fixture@example.invalid', role: 'admin', teams: [], personaScopes: ['*'] };
const plan = { tasks: [{ id: 'explain', skill: 'eng-007', persona: 'engineering', input: { code_or_module: 'fixture' }, dependencies: [] }] };
const graphConfig = { graph_id: 'fixture', name: 'Fixture graph', nodes: [{ id: 'first', agent: 'code-reviewer', depends_on: [], phase: 'main', parallel_group: null }, { id: 'last', agent: 'docs-writer', depends_on: ['first'], phase: 'main', parallel_group: null }], phases: { main: { label: 'Main', order: 1, description: '' } }, quality_gates: [], checkpoints: [], feedback_loops: [], shared_state: {}, execution_config: { parallel_execution: true, max_concurrent_agents: 2, global_timeout_minutes: 2, per_node_timeout_minutes: 1, retry_backoff_multiplier: 1, status_reporting_interval_seconds: 1 } };

describe('canonical entrypoint adapters', () => {
  it('bounds nested definitions before admission and preserves independent DAG roots', () => {
    const leaf = getCompiledDefinition('eng-007', 'engineering')!;
    let nested: UnifiedSkillDef = leaf;
    for (let i = 0; i < 6; i++) nested = { ...leaf, id: `nested-${i}`, steps: [{ id: 'child', order: 1, name: 'Child', agent: 'code-reviewer', kind: 'subworkflow', outputKey: 'child', subworkflow: { definition: nested } }], outputs: ['child'] };
    expect(() => compileDefinition(nested)).toThrow('depth');
    const independent = compileDefinition({ ...leaf, executionMode: 'dag', steps: leaf.steps.slice(0,2).map(step => ({ ...step, dependsOn: [] })), outputs: leaf.steps.slice(0,2).map(step => step.outputKey) });
    expect(independent.steps.every(step => step.dependsOn.length === 0)).toBe(true);
  });
  it('compiles supplied goal plans into frozen canonical child definitions', () => {
    const compiled = compileGoalRequest(owner, { description: 'Explain fixture', plan, simulate: true });
    expect(compiled.definition.steps[0]?.subworkflow?.definition.id).toBe('eng-007');
    expect(compiled.source.type).toBe('goal');
  });
  it('rejects planner hallucinations and nested persona escalation', () => {
    expect(() => compileGoalRequest(owner, { description: 'Fixture', plan: { tasks: [{ ...plan.tasks[0], skill: 'invented' }] } })).toThrow();
    expect(() => compileGoalRequest({ ...owner, personaScopes: ['marketing'] }, { description: 'Fixture', plan })).toThrow();
  });
  it('compiles SOMAN dependencies without trusting alternate agent identities', () => {
    const compiled = compileSomanRequest(owner, { intent: 'Fixture', persona: 'engineering', graphConfig, simulate: true });
    expect(compiled.definition.steps.find(step => step.id === 'last')?.dependsOn).toContain('first');
    expect(compiled.source.type).toBe('soman');
    expect(() => compileSomanRequest(owner, { intent: 'Fixture', persona: 'engineering', graphConfig: { ...graphConfig, nodes: [{ ...graphConfig.nodes[0], agent: 'invented' }] } })).toThrow();
    expect(() => compileSomanRequest(owner, { intent: 'Fixture', persona: 'engineering', graphConfig: { ...graphConfig, nodes: [{ ...graphConfig.nodes[0], depends_on: ['first'] }] } })).toThrow();
  });
  it('compiles the shipped SOMAN graph with bounded feedback and human gates', () => {
    const graph = JSON.parse(readFileSync(new URL('../../../agents/marketing/graph_runtime/graph.json', import.meta.url), 'utf8'));
    const compiled = compileSomanRequest(owner, { intent: 'Fixture', persona: 'marketing', graphConfig: graph, simulate: true });
    expect(compiled.definition.steps.some(step => step.kind === 'subworkflow')).toBe(true);
    expect(compiled.definition.steps.some(step => step.kind === 'approval')).toBe(true);
  });
  it('compiles swarm phases as bounded subworkflows and explicit approval gates', () => {
    const compiled = compileSwarmRequest(owner, { type: 'product_launch', mission: 'Fixture launch', simulate: true });
    expect(compiled.definition.steps.some(step => step.kind === 'subworkflow')).toBe(true);
    expect(requiredPersonas(compiled.definition)).toContain('marketing');
    expect(() => compileSwarmRequest({ ...owner, personaScopes: ['engineering'] }, { type: 'product_launch', mission: 'Fixture' })).toThrow();
    expect(() => compileSwarmRequest(owner, { type: 'unknown', mission: 'Fixture' })).toThrow();
  });
});
