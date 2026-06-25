/**
 * @agentos/router — Adaptive Worker Routing & Cost-Aware Model Router
 *
 * Intelligent routing that selects the optimal worker and LLM model
 * for each task based on capability matching, cost, latency, quality
 * history, and real-time load.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelProfile {
    id: string;
    name: string;                    // e.g., "gpt-4o", "claude-3-opus"
    provider: string;                // e.g., "openai", "anthropic"
    capabilities: string[];          // e.g., ["code", "reasoning", "creative"]
    costPer1kInputTokens: number;
    costPer1kOutputTokens: number;
    maxContextTokens: number;
    avgLatencyMs: number;
    qualityScore: number;            // 0-100, from evaluation harness
    rateLimit: number;               // requests per minute
    currentLoad: number;             // 0-1, from real-time metrics
    enabled: boolean;
}

export interface RoutingRequest {
    taskType: string;
    requiredCapabilities: string[];
    complexityEstimate: 'low' | 'medium' | 'high' | 'critical';
    maxLatencyMs?: number;
    maxCostUsd?: number;
    preferQuality?: boolean;         // quality over cost
    tokenEstimate: { input: number; output: number };
    tenantId: string;
}

export interface RoutingDecision {
    modelId: string;
    modelName: string;
    provider: string;
    estimatedCostUsd: number;
    estimatedLatencyMs: number;
    qualityScore: number;
    reason: string;
    alternatives: Array<{
        modelId: string;
        score: number;
        reason: string;
    }>;
}

export type RoutingStrategy = 'quality-first' | 'cost-first' | 'balanced' | 'latency-first';

export interface RouterConfig {
    strategy: RoutingStrategy;
    models: ModelProfile[];
    costBudgetPerHourUsd: number;
    fallbackModel: string;
    qualityThreshold: number;        // minimum quality score to consider
    enableLoadBalancing: boolean;
}

// ---------------------------------------------------------------------------
// Model Router
// ---------------------------------------------------------------------------

export class ModelRouter {
    private models = new Map<string, ModelProfile>();
    private usageTracker = new Map<string, { requests: number; costUsd: number; windowStart: Date }>();

    constructor(private config: RouterConfig) {
        for (const model of config.models) {
            this.models.set(model.id, model);
        }
    }

    /**
     * Route a request to the optimal model.
     */
    route(request: RoutingRequest): RoutingDecision {
        // Filter eligible models
        const eligible = Array.from(this.models.values()).filter((m) => {
            if (!m.enabled) return false;
            if (m.qualityScore < this.config.qualityThreshold) return false;

            // Check capability match
            const hasCapabilities = request.requiredCapabilities.every((cap) =>
                m.capabilities.includes(cap)
            );
            if (!hasCapabilities) return false;

            // Check context window
            const totalTokens = request.tokenEstimate.input + request.tokenEstimate.output;
            if (totalTokens > m.maxContextTokens) return false;

            // Check latency constraint
            if (request.maxLatencyMs && m.avgLatencyMs > request.maxLatencyMs) return false;

            // Check per-request cost ceiling
            if (request.maxCostUsd && this.estimateCost(m, request) > request.maxCostUsd) return false;

            return true;
        });

        if (eligible.length === 0) {
            // Fallback
            const fallback = this.models.get(this.config.fallbackModel);
            if (!fallback) throw new Error('No eligible models and no fallback configured');

            return {
                modelId: fallback.id,
                modelName: fallback.name,
                provider: fallback.provider,
                estimatedCostUsd: this.estimateCost(fallback, request),
                estimatedLatencyMs: fallback.avgLatencyMs,
                qualityScore: fallback.qualityScore,
                reason: 'Fallback — no models matched constraints',
                alternatives: [],
            };
        }

        // Score each model
        const scored = eligible.map((model) => ({
            model,
            score: this.scoreModel(model, request),
            cost: this.estimateCost(model, request),
        }));

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);

        // If we're at or over the hourly cost budget, do not pick the
        // highest-scoring (potentially expensive) model — force the cheapest
        // eligible model instead. A zero/unset budget disables this guard.
        if (
            this.config.costBudgetPerHourUsd > 0 &&
            this.getHourlyCost() >= this.config.costBudgetPerHourUsd
        ) {
            const cheapest = scored.reduce((a, b) => (b.cost < a.cost ? b : a));
            return {
                modelId: cheapest.model.id,
                modelName: cheapest.model.name,
                provider: cheapest.model.provider,
                estimatedCostUsd: cheapest.cost,
                estimatedLatencyMs: cheapest.model.avgLatencyMs,
                qualityScore: cheapest.model.qualityScore,
                reason: 'Hourly cost budget reached — selecting cheapest eligible model',
                alternatives: scored
                    .filter((s) => s.model.id !== cheapest.model.id)
                    .slice(0, 3)
                    .map((s) => ({
                        modelId: s.model.id,
                        score: s.score,
                        reason: `Cost: $${s.cost.toFixed(4)}, Quality: ${s.model.qualityScore}, Latency: ${s.model.avgLatencyMs}ms`,
                    })),
            };
        }

        const best = scored[0];
        const alternatives = scored.slice(1, 4).map((s) => ({
            modelId: s.model.id,
            score: s.score,
            reason: `Cost: $${s.cost.toFixed(4)}, Quality: ${s.model.qualityScore}, Latency: ${s.model.avgLatencyMs}ms`,
        }));

        return {
            modelId: best.model.id,
            modelName: best.model.name,
            provider: best.model.provider,
            estimatedCostUsd: best.cost,
            estimatedLatencyMs: best.model.avgLatencyMs,
            qualityScore: best.model.qualityScore,
            reason: this.explainDecision(best.model, request),
            alternatives,
        };
    }

    /**
     * Record actual usage for budget tracking.
     */
    recordUsage(modelId: string, costUsd: number): void {
        const now = new Date();
        const entry = this.usageTracker.get(modelId) ?? { requests: 0, costUsd: 0, windowStart: now };

        // Reset if window expired (1 hour)
        if (now.getTime() - entry.windowStart.getTime() > 3_600_000) {
            entry.requests = 0;
            entry.costUsd = 0;
            entry.windowStart = now;
        }

        entry.requests++;
        entry.costUsd += costUsd;
        this.usageTracker.set(modelId, entry);
    }

    /**
     * Update a model's real-time metrics.
     */
    updateModelMetrics(modelId: string, metrics: { avgLatencyMs?: number; qualityScore?: number; currentLoad?: number }): void {
        const model = this.models.get(modelId);
        if (!model) return;

        if (metrics.avgLatencyMs !== undefined) model.avgLatencyMs = metrics.avgLatencyMs;
        if (metrics.qualityScore !== undefined) model.qualityScore = metrics.qualityScore;
        if (metrics.currentLoad !== undefined) model.currentLoad = metrics.currentLoad;
    }

    /**
     * Get total hourly spend.
     */
    getHourlyCost(): number {
        let total = 0;
        for (const entry of this.usageTracker.values()) {
            total += entry.costUsd;
        }
        return total;
    }

    // -------------------------------------------------------------------------
    // Scoring
    // -------------------------------------------------------------------------

    private scoreModel(model: ModelProfile, request: RoutingRequest): number {
        const cost = this.estimateCost(model, request);
        const strategy = request.preferQuality ? 'quality-first' : this.config.strategy;

        const weights = STRATEGY_WEIGHTS[strategy];

        const qualityNorm = model.qualityScore / 100;
        const costNorm = 1 - Math.min(cost / 0.10, 1); // normalize to $0.10 max
        const latencyNorm = 1 - Math.min(model.avgLatencyMs / 10_000, 1);
        const loadNorm = 1 - model.currentLoad;

        // Complexity boost for high-quality models on complex tasks
        const complexityBoost =
            request.complexityEstimate === 'critical' ? qualityNorm * 0.3 :
                request.complexityEstimate === 'high' ? qualityNorm * 0.15 : 0;

        return (
            weights.quality * qualityNorm +
            weights.cost * costNorm +
            weights.latency * latencyNorm +
            weights.load * loadNorm +
            complexityBoost
        );
    }

    private estimateCost(model: ModelProfile, request: RoutingRequest): number {
        return (
            (request.tokenEstimate.input / 1000) * model.costPer1kInputTokens +
            (request.tokenEstimate.output / 1000) * model.costPer1kOutputTokens
        );
    }

    private explainDecision(model: ModelProfile, request: RoutingRequest): string {
        const cost = this.estimateCost(model, request);
        return `Selected ${model.name}: quality=${model.qualityScore}, cost=$${cost.toFixed(4)}, latency=${model.avgLatencyMs}ms, load=${(model.currentLoad * 100).toFixed(0)}%`;
    }
}

// ---------------------------------------------------------------------------
// Strategy Weights
// ---------------------------------------------------------------------------

const STRATEGY_WEIGHTS: Record<RoutingStrategy, { quality: number; cost: number; latency: number; load: number }> = {
    'quality-first': { quality: 0.50, cost: 0.15, latency: 0.15, load: 0.20 },
    'cost-first': { quality: 0.15, cost: 0.50, latency: 0.15, load: 0.20 },
    'balanced': { quality: 0.30, cost: 0.30, latency: 0.20, load: 0.20 },
    'latency-first': { quality: 0.15, cost: 0.15, latency: 0.50, load: 0.20 },
};
