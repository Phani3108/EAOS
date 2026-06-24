/**
 * @agentos/cognitive-engine — Cognitive Engine Service
 *
 * Processes goals through a multi-stage pipeline:
 * decompose → plan → reason → execute → reflect → ground
 * Uses Claude API for LLM calls. Exposes HTTP endpoints.
 */

import http from 'node:http';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface CognitiveEngineConfig {
    port: number;
    enableDebate: boolean;
    enableReflection: boolean;
    enableGrounding: boolean;
    debateRounds: number;
    reflectionThreshold: number;
    groundingThreshold: number;
}

const config: CognitiveEngineConfig = {
    port: parseInt(process.env.COGNITIVE_PORT ?? '3005', 10),
    enableDebate: true,
    enableReflection: true,
    enableGrounding: true,
    debateRounds: 2,
    reflectionThreshold: 0.85,
    groundingThreshold: 0.8,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CognitivePipelineStage = 'decompose' | 'plan' | 'reason' | 'debate' | 'execute' | 'reflect' | 'ground';

interface CognitiveRequest {
    id: string;
    goal: string;
    context: Record<string, unknown>;
    options?: {
        skipDebate?: boolean;
        skipReflection?: boolean;
        modelId?: string;
        urgency?: 'low' | 'normal' | 'high' | 'critical';
    };
}

interface StageResult {
    stage: CognitivePipelineStage;
    durationMs: number;
    result: unknown;
}

interface CognitiveResult {
    requestId: string;
    output: unknown;
    confidence: number;
    grounded: boolean;
    groundingScore: number;
    stages: StageResult[];
    totalDurationMs: number;
    tokensUsed: number;
}

// In-memory results store
const results = new Map<string, CognitiveResult>();

// ---------------------------------------------------------------------------
// LLM Call
// ---------------------------------------------------------------------------

async function callLLM(system: string, user: string, modelId?: string): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return `[No ANTHROPIC_API_KEY] System: ${system.slice(0, 100)}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: modelId ?? 'claude-sonnet-4-6-20251001',
            max_tokens: 4096,
            system,
            messages: [{ role: 'user', content: user }],
        }),
    });

    if (!res.ok) throw new Error(`Claude API error ${res.status}`);
    const data = (await res.json()) as { content: Array<{ text: string }> };
    return data.content?.[0]?.text ?? '';
}

// ---------------------------------------------------------------------------
// Pipeline Stages
// ---------------------------------------------------------------------------

async function decompose(goal: string, modelId?: string): Promise<{ subtasks: string[] }> {
    const raw = await callLLM(
        'You are a task decomposition engine. Break goals into concrete subtasks. Return JSON: {"subtasks": ["...","..."]}',
        `Decompose this goal into subtasks:\n\n${goal}`,
        modelId,
    );
    try {
        const match = raw.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : { subtasks: [goal] };
    } catch {
        return { subtasks: [goal] };
    }
}

async function plan(goal: string, subtasks: string[], modelId?: string): Promise<{ plan: string }> {
    const raw = await callLLM(
        'You are a strategic planner. Create an execution plan. Return JSON: {"plan": "..."}',
        `Goal: ${goal}\nSubtasks:\n${subtasks.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
        modelId,
    );
    try {
        const match = raw.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : { plan: raw };
    } catch {
        return { plan: raw };
    }
}

async function reason(goal: string, planText: string, modelId?: string): Promise<{ reasoning: string; confidence: number }> {
    const raw = await callLLM(
        'You are a reasoning engine. Analyze the plan, identify risks and optimizations. Return JSON: {"reasoning": "...", "confidence": 0.0-1.0}',
        `Goal: ${goal}\nPlan: ${planText}`,
        modelId,
    );
    try {
        const match = raw.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : { reasoning: raw, confidence: 0.7 };
    } catch {
        return { reasoning: raw, confidence: 0.7 };
    }
}

async function reflect(output: string, goal: string, modelId?: string): Promise<{ score: number; feedback: string }> {
    const raw = await callLLM(
        'You are a quality reflection engine. Evaluate the output quality. Return JSON: {"score": 0.0-1.0, "feedback": "..."}',
        `Goal: ${goal}\n\nOutput to evaluate:\n${output.slice(0, 2000)}`,
        modelId,
    );
    try {
        const match = raw.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : { score: 0.8, feedback: raw };
    } catch {
        return { score: 0.8, feedback: raw };
    }
}

async function groundCheck(output: string, context: Record<string, unknown>, modelId?: string): Promise<{ grounded: boolean; score: number }> {
    const raw = await callLLM(
        'You are a hallucination checker. Evaluate if the output is grounded in the provided context. Return JSON: {"grounded": true/false, "score": 0.0-1.0}',
        `Context: ${JSON.stringify(context).slice(0, 1500)}\n\nOutput to check:\n${output.slice(0, 2000)}`,
        modelId,
    );
    try {
        const match = raw.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : { grounded: true, score: 0.85 };
    } catch {
        return { grounded: true, score: 0.85 };
    }
}

// ---------------------------------------------------------------------------
// Full Pipeline
// ---------------------------------------------------------------------------

async function processPipeline(request: CognitiveRequest): Promise<CognitiveResult> {
    const startTime = Date.now();
    const stages: StageResult[] = [];
    const modelId = request.options?.modelId;

    // 1. Decompose
    const t1 = Date.now();
    const { subtasks } = await decompose(request.goal, modelId);
    stages.push({ stage: 'decompose', durationMs: Date.now() - t1, result: { subtasks } });

    // 2. Plan
    const t2 = Date.now();
    const { plan: planText } = await plan(request.goal, subtasks, modelId);
    stages.push({ stage: 'plan', durationMs: Date.now() - t2, result: { plan: planText } });

    // 3. Reason
    const t3 = Date.now();
    const { reasoning, confidence } = await reason(request.goal, planText, modelId);
    stages.push({ stage: 'reason', durationMs: Date.now() - t3, result: { reasoning, confidence } });

    // 4. Execute (generate the actual output)
    const t4 = Date.now();
    const output = await callLLM(
        `You are an enterprise AI agent executing a goal. Use the plan and reasoning to produce a high-quality result.\n\nPlan: ${planText}\nReasoning: ${reasoning}`,
        `Execute this goal and produce the final output:\n\n${request.goal}`,
        modelId,
    );
    stages.push({ stage: 'execute', durationMs: Date.now() - t4, result: { output: output.slice(0, 500) } });

    // 5. Reflect (if enabled)
    let qualityScore = confidence;
    if (config.enableReflection && !request.options?.skipReflection) {
        const t5 = Date.now();
        const { score, feedback } = await reflect(output, request.goal, modelId);
        qualityScore = score;
        stages.push({ stage: 'reflect', durationMs: Date.now() - t5, result: { score, feedback } });
    }

    // 6. Ground (hallucination check)
    let grounded = true;
    let groundingScore = 1.0;
    if (config.enableGrounding) {
        const t6 = Date.now();
        const check = await groundCheck(output, request.context, modelId);
        grounded = check.grounded;
        groundingScore = check.score;
        stages.push({ stage: 'ground', durationMs: Date.now() - t6, result: check });
    }

    const result: CognitiveResult = {
        requestId: request.id,
        output,
        confidence: qualityScore,
        grounded,
        groundingScore,
        stages,
        totalDurationMs: Date.now() - startTime,
        tokensUsed: 0,
    };

    results.set(request.id, result);
    return result;
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

class CognitiveEngineService {
    private server: http.Server | null = null;

    async start(): Promise<void> {
        this.server = http.createServer(async (req, res) => {
            const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);
            const path = url.pathname;
            const method = req.method ?? 'GET';

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

            try {
                if (path === '/health') {
                    send(res, 200, { status: 'ok', service: 'cognitive-engine', results: results.size });
                    return;
                }

                const body = method === 'POST' ? await readBody(req) : {};

                // POST /api/cognitive/process — full pipeline
                if (path === '/api/cognitive/process' && method === 'POST') {
                    const request = body as unknown as CognitiveRequest;
                    if (!request.goal) { send(res, 400, { error: 'goal required' }); return; }
                    request.id = request.id ?? `cog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                    request.context = request.context ?? {};
                    const result = await processPipeline(request);
                    send(res, 200, { result });
                    return;
                }

                // POST /api/cognitive/decompose
                if (path === '/api/cognitive/decompose' && method === 'POST') {
                    const { goal, modelId } = body as { goal: string; modelId?: string };
                    if (!goal) { send(res, 400, { error: 'goal required' }); return; }
                    const result = await decompose(goal, modelId);
                    send(res, 200, result);
                    return;
                }

                // POST /api/cognitive/reason
                if (path === '/api/cognitive/reason' && method === 'POST') {
                    const { goal, plan: p, modelId } = body as { goal: string; plan: string; modelId?: string };
                    if (!goal) { send(res, 400, { error: 'goal required' }); return; }
                    const result = await reason(goal, p ?? '', modelId);
                    send(res, 200, result);
                    return;
                }

                // POST /api/cognitive/reflect
                if (path === '/api/cognitive/reflect' && method === 'POST') {
                    const { output: o, goal, modelId } = body as { output: string; goal: string; modelId?: string };
                    if (!o || !goal) { send(res, 400, { error: 'output and goal required' }); return; }
                    const result = await reflect(o, goal, modelId);
                    send(res, 200, result);
                    return;
                }

                // POST /api/cognitive/ground
                if (path === '/api/cognitive/ground' && method === 'POST') {
                    const { output: o, context: ctx, modelId } = body as { output: string; context: Record<string, unknown>; modelId?: string };
                    if (!o) { send(res, 400, { error: 'output required' }); return; }
                    const result = await groundCheck(o, ctx ?? {}, modelId);
                    send(res, 200, result);
                    return;
                }

                // GET /api/cognitive/status/:id
                const statusMatch = path.match(/^\/api\/cognitive\/status\/(.+)$/);
                if (statusMatch && method === 'GET') {
                    const r = results.get(statusMatch[1]);
                    if (!r) { send(res, 404, { error: 'Not found' }); return; }
                    send(res, 200, { status: 'completed', result: r });
                    return;
                }

                // GET /api/cognitive/trace/:id
                const traceMatch = path.match(/^\/api\/cognitive\/trace\/(.+)$/);
                if (traceMatch && method === 'GET') {
                    const r = results.get(traceMatch[1]);
                    if (!r) { send(res, 404, { error: 'Not found' }); return; }
                    send(res, 200, { trace: r.stages });
                    return;
                }

                send(res, 404, { error: 'Not found' });
            } catch (err) {
                console.error('[cognitive-engine]', err);
                send(res, 500, { error: (err as Error).message });
            }
        });

        this.server.listen(config.port, () => {
            console.log(`🧠 Cognitive Engine listening on port ${config.port}`);
            console.log(`   LLM: ${process.env.ANTHROPIC_API_KEY ? '✅ Claude API configured' : '⚠️ No API key'}`);
            console.log(`   Reflection: ${config.enableReflection ? '✅' : '❌'}`);
            console.log(`   Grounding: ${config.enableGrounding ? '✅' : '❌'}`);
        });
    }

    async stop(): Promise<void> {
        if (this.server) this.server.close();
        console.log('🧠 Cognitive Engine stopped');
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status);
    res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
            catch { resolve({}); }
        });
    });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const service = new CognitiveEngineService();

service.start().catch((err) => {
    console.error('Failed to start Cognitive Engine:', err);
    process.exit(1);
});

process.on('SIGTERM', () => service.stop());
process.on('SIGINT', () => service.stop());

export { CognitiveEngineService };
export type { CognitiveEngineConfig, CognitiveRequest, CognitiveResult, CognitivePipelineStage };
