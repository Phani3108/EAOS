#!/usr/bin/env node

/**
 * eaos — EAOS Command Line Interface
 *
 * Usage:
 *   eaos up                    Start all services
 *   eaos down                  Stop all services
 *   eaos status                Show service status
 *   eaos logs [service]        Tail service logs
 *   eaos exec <goal>           Execute a goal
 *   eaos skills                List available skills
 *   eaos validate <file>       Validate a workflow without executing
 *   eaos workers               List active workers
 *   eaos workflows             List workflows
 *   eaos capabilities          Show system capabilities
 *   eaos trace <id>            Show execution trace
 *   eaos health                Health check all services
 *   eaos config                Show configuration
 */

import { execFileSync, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GatewayWorkflowClient, PlatformClient } from '@agentos/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const DEPLOY = resolve(ROOT, 'deploy');
const GATEWAY_URL = (process.env.GATEWAY_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const client = new GatewayWorkflowClient({ baseUrl: GATEWAY_URL, headers: async (): Promise<Record<string, string>> => {
    const credential = process.env.EAOS_TOKEN || process.env.EAOS_API_KEY;
    if (credential && !/^[\x21-\x7e]{1,8192}$/.test(credential)) throw new Error('Invalid authentication credential format');
    if (process.env.EAOS_TOKEN) return { Authorization: `Bearer ${process.env.EAOS_TOKEN}` };
    if (process.env.EAOS_API_KEY) return { 'X-API-Key': process.env.EAOS_API_KEY };
    throw new Error('Set EAOS_TOKEN or EAOS_API_KEY for authenticated commands');
} });
const platform = new PlatformClient(client);
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const required = (args: string[], index: number, usage: string) => { const value = args[index]; if (!value || value.startsWith('--')) throw new Error(usage); return value; };
const json = async (path: string): Promise<any> => { const text = await readFile(resolve(path), 'utf8'); if (text.length > 1_000_000) throw new Error('Input file exceeds 1 MB'); return JSON.parse(text); };

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const commands: Record<string, (args: string[]) => Promise<void>> = {
    up: async () => { execFileSync('docker', ['compose','-f','docker-compose.production.yml','up','-d'], { cwd: DEPLOY, stdio: 'inherit' }); },
    down: async () => { execFileSync('docker', ['compose','-f','docker-compose.production.yml','down'], { cwd: DEPLOY, stdio: 'inherit' }); },
    logs: async args => {
        if (args[0] && !/^[a-z][a-z0-9-]{0,40}$/.test(args[0])) throw new Error('Invalid service name');
        const proc = spawn('docker', ['compose','-f','docker-compose.production.yml','logs','-f', ...(args[0] ? [args[0]] : [])], { cwd: DEPLOY, stdio: 'inherit' });
        await new Promise<void>((done, reject) => { proc.once('error', reject); proc.once('close', code => { process.exitCode = code ?? 1; done(); }); });
    },
    status: async () => { const response = await fetch(`${GATEWAY_URL}/api/ready`, { redirect: 'error', signal: AbortSignal.timeout(10_000) }); print(await response.json()); if (!response.ok) process.exitCode = 1; },
    health: async () => commands.status([]),
    config: async () => print({ gateway: GATEWAY_URL, authenticationConfigured: Boolean(process.env.EAOS_TOKEN || process.env.EAOS_API_KEY) }),
    skills: async () => print(await client.platform('/api/catalog')),
    capabilities: async () => print(await client.platform('/api/certification')),
    workers: async () => print((await platform.summary()).jobs),
    workflows: async () => print(await platform.packages()),
    ops: async () => print(await platform.summary()),
    recovery: async () => print(await platform.recovery()),
    exec: async args => { const description = args.join(' '); if (!description) throw new Error('Usage: eaos exec <goal>'); print(await client.platform('/api/orchestrator/goal', 'POST', { description })); },
    run: async args => {
        const workflow = await json(required(args, 0, 'Usage: eaos run workflow.json [inputs.json] [--live] [--workflow-engine]'));
        const variables = args[1] && !args[1].startsWith('--') ? await json(args[1]) : {};
        print(await client.submit(args.includes('--workflow-engine') ? 'workflow-engine' : 'sdk', workflow, variables, !args.includes('--live')));
    },
    validate: async args => {
        const path = required(args, 0, 'Usage: eaos validate workflow.json|workflow.yaml');
        const result = /\.ya?ml$/i.test(path) ? await client.platform<any>('/api/workflows/inspect-yaml', 'POST', { source: await readFile(resolve(path), 'utf8') }) : await client.platform<any>('/api/workflows/validate', 'POST', { format: args.includes('--workflow-engine') ? 'workflow-engine' : 'sdk', workflow: await json(path), variables: {}, simulate: true });
        print(result);
        if (result.definitions?.some((definition: { status: string }) => definition.status !== 'compiled')) process.exitCode = 1;
    },
    get: async args => { const result = await client.snapshot(required(args, 0, 'Usage: eaos get <run-id>')); if (!result) throw new Error('Run not found'); print(result); },
    trace: async args => print(await client.trace(required(args, 0, 'Usage: eaos trace <run-id>'))),
    export: async args => { const id = required(args, 0, 'Usage: eaos export <run-id>'); print({ execution: await client.snapshot(id), trace: await client.trace(id) }); },
    watch: async args => {
        const id = required(args, 0, 'Usage: eaos watch <run-id>');
        let previous = '';
        for (;;) {
            const run = await client.snapshot(id);
            if (!run) throw new Error('Run not found');
            const state = JSON.stringify({ id: run.id, status: run.status, steps: run.steps.map(step => ({ id: step.stepId, status: step.status })) });
            if (state !== previous) { console.log(state); previous = state; }
            if (!['queued','running','paused'].includes(run.status)) { if (!['completed','simulated'].includes(run.status)) process.exitCode = 1; break; }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    },
    approve: async args => { await client.decide(required(args, 0, 'Usage: eaos approve <run> <step> [confirmations.json]'), required(args, 1, 'Step ID required'), true, args[2] ? await json(args[2]) : {}); print({ accepted: true }); },
    reject: async args => { await client.decide(required(args, 0, 'Usage: eaos reject <run> <step>'), required(args, 1, 'Step ID required'), false); print({ accepted: true }); },
    cancel: async args => print({ cancelled: await client.cancel(required(args, 0, 'Usage: eaos cancel <run-id>')) }),
    retry: async args => print(await client.platform(`/api/operations/runs/${encodeURIComponent(required(args, 0, 'Usage: eaos retry <run-id>'))}/retry`, 'POST', {})),
    events: async args => print(await platform.events(args[0] ?? '0')),
    'dataset-create': async args => print(await platform.createDataset(await json(required(args, 0, 'Usage: eaos dataset-create dataset.json')))),
    evaluate: async args => print(await platform.evaluate(await json(required(args, 0, 'Usage: eaos evaluate evidence.json')))),
    'connector-contracts': async () => print(await platform.connectorContracts()),
    conformance: async args => { const report = await platform.connectorConformance(required(args, 0, 'Package ID required'), required(args, 1, 'Manifest hash required')); print(report); if (!report.activationEligible) process.exitCode = 1; },
    stage: async args => print(await platform.stage(await json(required(args, 0, 'Usage: eaos stage candidate.json')))),
    'prompt-stage': async args => print(await client.platform('/api/prompts', 'POST', await json(required(args, 0, 'Prompt request JSON required')))),
    preview: async args => print(await platform.preview(required(args, 0, 'Package ID required'), required(args, 1, 'Candidate hash required'), await json(required(args, 2, 'Input JSON file required')), !args.includes('--live'), crypto.randomUUID())),
    review: async args => print(await client.platform(`/api/registry/packages/${encodeURIComponent(required(args, 0, 'Package ID required'))}/review`, 'POST', await json(required(args, 1, 'Review JSON file required')))),
    activate: async args => print(await platform.activate(required(args, 0, 'Package ID required'), required(args, 1, 'Version hash required'), Number(required(args, 2, 'Expected revision required')))),
    members: async () => print(await platform.members()),
    'member-update': async args => print(await client.platform(`/api/admin/members/${encodeURIComponent(required(args, 0, 'Member ID required'))}`, 'PATCH', await json(required(args, 1, 'Member update JSON required')))),
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const [, , command, ...args] = process.argv;
    if (!command || command === '--help') {
        console.log(`eaos — authenticated EAOS CLI\n\nCommands: ${Object.keys(commands).join(', ')}\n\nSet GATEWAY_URL and EAOS_TOKEN or EAOS_API_KEY.\nWorkflow runs default to simulation; --live is explicit.\nJSON output can be redirected for evidence export. External writes still require server-side approval.`);
        return;
    }
    const handler = commands[command];
    if (!handler) throw new Error(`Unknown command: ${command}`);
    await handler(args);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'CLI operation failed'); process.exitCode = 1; });
