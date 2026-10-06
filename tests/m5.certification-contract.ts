import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { PostgresRunRepository } from '../packages/db/dist/run-repository.js';
import type { CompiledDefinition } from '../services/gateway/dist/definition-registry.js';

export function certificationInputs(definition: CompiledDefinition, artifactId: string): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const field of definition.inputs.filter(field => field.required)) {
    if (field.type === 'file') input[field.id] = field.multiple ? [{ artifactId }] : { artifactId };
    else if (field.type === 'number') input[field.id] = 1;
    else if (field.type === 'toggle') input[field.id] = false;
    else if (field.type === 'date') input[field.id] = '2026-09-01';
    else if (field.type === 'url') input[field.id] = 'https://example.invalid/fixture';
    else if (field.type === 'select' || field.type === 'multiselect') {
      const first = field.options?.[0];
      const value = typeof first === 'string' ? first : first?.value;
      assert.ok(value, `No valid option for ${definition.id}/${field.id}`);
      input[field.id] = field.type === 'multiselect' ? [value] : value;
    } else if (field.type === 'tags') input[field.id] = ['fixture'];
    else input[field.id] = 'Fixture source evidence for a human-reviewed draft';
  }
  return input;
}
export async function verifyCatalogCertification(h: { tenantId: string; runs: PostgresRunRepository; request(tenant: string, path: string, body?: unknown): Promise<{ status: number; data: any }>; waitStatus(tenant: string, id: string, status: string): Promise<any> }) {
  const { getCompiledCatalog } = await import('../services/gateway/dist/definition-registry.js');
  const { validateSkillInputs } = await import('../services/gateway/dist/validation.js');
  const catalog = getCompiledCatalog();
  const source = await h.request(h.tenantId, '/api/artifacts', { fileName: 'evidence.txt', mimeType: 'text/plain', contentBase64: Buffer.from('Synthetic certification source; not real employee or candidate data').toString('base64') });
  assert.equal(source.status, 201);
  const budgetBefore = await h.request(h.tenantId, '/api/runtime/usage');
  const counts: Record<string, number> = {};
  let flagships = 0;
  for (const definition of catalog) {
    const inputs = validateSkillInputs(definition.inputs, certificationInputs(definition, source.data.artifactId));
    const submitted = await h.request(h.tenantId, '/api/execute', { persona: definition.persona, skillId: definition.id, inputs, simulate: true });
    assert.ok([200,201].includes(submitted.status), `${definition.id}: ${JSON.stringify(submitted.data)}`);
    let run = await h.runs.get(h.tenantId, submitted.data.execution.id);
    for (let attempt = 0; attempt < 200 && run?.status !== 'simulated'; attempt++) { await delay(100); run = await h.runs.get(h.tenantId, submitted.data.execution.id); }
    assert.equal(run?.status, 'simulated', `${definition.id}: ${JSON.stringify(run?.steps.filter(step => step.error))}`);
    assert.ok(run);
    assert.equal(run.definitionHash, definition.definitionHash);
    assert.ok(run.steps.every(step => step.status === 'simulated' && step.provenance === 'simulated'));
    assert.ok(definition.outputs.every(key => typeof run.outputs[key] === 'string' && run.outputs[key].length));
    counts[definition.persona] = (counts[definition.persona] ?? 0) + 1;
    if (definition.id.startsWith('fw-')) flagships++;
  }
  assert.deepEqual(Object.keys(counts).sort(), ['engineering','hr','marketing','product','program','ta']);
  assert.equal(flagships, 5);
  assert.deepEqual((await h.request(h.tenantId, '/api/runtime/usage')).data, budgetBefore.data);
  const report = await h.request(h.tenantId, '/api/certification');
  assert.equal(report.data.definitions.length, catalog.length);
  assert.ok(report.data.definitions.every((row: any) => row.certification.vendorSandbox === 'not-certified' && row.certification.domainReview === 'not-reviewed'));
  const starters: Record<string, unknown> = {};
  for (const name of ['content-pipeline.yaml','incident-response.yaml','onboarding.yaml','pr-review.yaml','starters/domain-workflows.yaml','starters/ready-to-use.yaml']) {
    const source = await readFile(resolve('workflows', name), 'utf8');
    const result = await h.request(h.tenantId, '/api/workflows/inspect-yaml', { source });
    assert.equal(result.status, 200, name);
    assert.ok(result.data.definitions.every((row: any) => row.status === 'compiled' || row.status === 'unsupported' && row.reason));
    starters[name] = result.data.definitions.map((row: any) => ({ id: row.id, status: row.status, reason: row.reason }));
  }
  console.log(`PASS M5 automated schema/simulation matrix: ${catalog.length} definitions, ${flagships} flagships, families=${JSON.stringify(counts)}; vendor and human certification remain pending`);
  console.log(`M5 starter conformance: ${JSON.stringify(starters)}`);
}
