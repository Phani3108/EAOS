"use strict";
/**
 * AgentOS Gateway Load Test
 * Measures p50/p95/p99 latency, error rate, and throughput across ramp phases.
 *
 * Usage:
 *   npx tsx tests/load-test.ts
 *   npx tsx tests/load-test.ts --url http://localhost:3000 --concurrency 100 --duration 30
 */
Object.defineProperty(exports, "__esModule", { value: true });
const args = process.argv.slice(2);
function getArg(name, fallback) {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const BASE_URL = getArg('url', 'http://localhost:3000');
const MAX_CONCURRENCY = parseInt(getArg('concurrency', '100'), 10);
const PHASE_DURATION_S = parseInt(getArg('duration', '20'), 10);
const API_KEY = getArg('key', 'eos-dev-key');
// ---------------------------------------------------------------------------
// Single request
// ---------------------------------------------------------------------------
async function singleRequest() {
    const start = Date.now();
    try {
        const res = await fetch(`${BASE_URL}/api/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY,
            },
            body: JSON.stringify({
                persona: 'engineering',
                skillId: 'code-review',
                inputs: { codeSnippet: 'function add(a, b) { return a + b; }' },
                simulate: true,
            }),
        });
        return { ok: res.status < 500, status: res.status, latencyMs: Date.now() - start };
    }
    catch {
        return { ok: false, status: 0, latencyMs: Date.now() - start };
    }
}
// ---------------------------------------------------------------------------
// Percentile helpers
// ---------------------------------------------------------------------------
function percentile(sorted, p) {
    if (sorted.length === 0)
        return 0;
    const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
    return sorted[idx];
}
async function runPhase(concurrency, durationMs, label) {
    const latencies = [];
    let errors = 0;
    let total = 0;
    const start = Date.now();
    const workers = Array.from({ length: concurrency }, async () => {
        while (Date.now() - start < durationMs) {
            const r = await singleRequest();
            latencies.push(r.latencyMs);
            total++;
            if (!r.ok)
                errors++;
        }
    });
    await Promise.all(workers);
    latencies.sort((a, b) => a - b);
    const elapsed = (Date.now() - start) / 1000;
    return {
        phase: label,
        concurrency,
        totalRequests: total,
        successRate: total > 0 ? ((total - errors) / total) * 100 : 0,
        rps: Math.round(total / elapsed),
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
        errorRate: total > 0 ? `${((errors / total) * 100).toFixed(1)}%` : '0%',
    };
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function printTable(results) {
    const cols = ['Phase', 'Concur', 'Requests', 'RPS', 'p50ms', 'p95ms', 'p99ms', 'Errors', 'Success%'];
    const rows = results.map(r => [
        r.phase,
        String(r.concurrency),
        String(r.totalRequests),
        String(r.rps),
        String(r.p50),
        String(r.p95),
        String(r.p99),
        r.errorRate,
        `${r.successRate.toFixed(1)}%`,
    ]);
    const widths = cols.map((c, i) => Math.max(c.length, ...rows.map(r => r[i].length)));
    const sep = widths.map(w => '-'.repeat(w + 2)).join('+');
    const fmt = (row) => row.map((v, i) => ` ${v.padEnd(widths[i])} `).join('|');
    console.log('');
    console.log(sep);
    console.log(fmt(cols));
    console.log(sep);
    for (const r of rows)
        console.log(fmt(r));
    console.log(sep);
    console.log('');
}
(async () => {
    console.log(`\nAgentOS Load Test → ${BASE_URL}`);
    console.log(`Phases: 10 → 50 → ${MAX_CONCURRENCY} concurrency | ${PHASE_DURATION_S}s each\n`);
    // Warm up
    await singleRequest();
    const durationMs = PHASE_DURATION_S * 1000;
    const results = [];
    results.push(await runPhase(10, durationMs, 'Phase 1 (warm)'));
    console.log(`  Phase 1 done — ${results[0].totalRequests} reqs @ ${results[0].rps} rps`);
    results.push(await runPhase(50, durationMs, 'Phase 2 (ramp)'));
    console.log(`  Phase 2 done — ${results[1].totalRequests} reqs @ ${results[1].rps} rps`);
    results.push(await runPhase(MAX_CONCURRENCY, durationMs, 'Phase 3 (peak)'));
    console.log(`  Phase 3 done — ${results[2].totalRequests} reqs @ ${results[2].rps} rps`);
    printTable(results);
    const peak = results[2];
    if (peak.p95 > 2000) {
        console.warn(`WARNING: p95 latency ${peak.p95}ms exceeds 2000ms SLA`);
    }
    if (peak.successRate < 99) {
        console.warn(`WARNING: success rate ${peak.successRate.toFixed(1)}% below 99% threshold`);
    }
})();
//# sourceMappingURL=load-test.js.map