/**
 * @agentos/watchers — Autonomous Watcher Agents
 *
 * Background agents that continuously monitor system health, drift,
 * anomalies, cost, compliance, and performance. Watchers emit events
 * and can trigger workflows or escalations autonomously.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WatcherType = 'drift' | 'anomaly' | 'cost' | 'compliance' | 'performance' | 'security' | 'custom';
export type WatcherSeverity = 'info' | 'warning' | 'critical' | 'emergency';
export type WatcherStatus = 'active' | 'paused' | 'triggered' | 'cooldown' | 'disabled';

export interface WatcherConfig {
    id: string;
    name: string;
    type: WatcherType;
    description: string;
    /** How often to run the check (ms) */
    intervalMs: number;
    /** Minimum time between alerts (ms) */
    cooldownMs: number;
    /** Enable autonomous remediation */
    autoRemediate: boolean;
    /** Workflow to trigger on alert */
    triggerWorkflow?: string;
    /** Channels to notify */
    notifyChannels: string[];
    /** Alert severity */
    severity: WatcherSeverity;
    /** Watcher-specific configuration */
    params: Record<string, unknown>;
    enabled: boolean;
}

export interface WatcherAlert {
    id: string;
    watcherId: string;
    watcherName: string;
    type: WatcherType;
    severity: WatcherSeverity;
    title: string;
    description: string;
    detectedAt: Date;
    metrics: Record<string, number>;
    context: Record<string, unknown>;
    remediationSuggested?: string;
    remediationApplied?: boolean;
}

export interface WatcherCheckResult {
    healthy: boolean;
    alerts: WatcherAlert[];
    metrics: Record<string, number>;
    checkedAt: Date;
    durationMs: number;
}

// ---------------------------------------------------------------------------
// Watcher Runner
// ---------------------------------------------------------------------------

/**
 * Abstract base for all watcher agents.
 * Subclass this and implement `check()` to create a watcher.
 */
export abstract class BaseWatcher {
    private _status: WatcherStatus = 'active';
    private _lastCheck?: Date;
    private _lastAlert?: Date;
    private _alertCount = 0;
    private _checkCount = 0;
    private _interval?: ReturnType<typeof setInterval>;

    constructor(readonly config: WatcherConfig) { }

    get status(): WatcherStatus { return this._status; }
    get stats() {
        return {
            alertCount: this._alertCount,
            checkCount: this._checkCount,
            lastCheck: this._lastCheck,
            lastAlert: this._lastAlert,
        };
    }

    /**
     * Main check function — implemented by concrete watchers.
     */
    abstract check(): Promise<WatcherCheckResult>;

    /**
     * Start the watcher loop.
     */
    start(): void {
        if (!this.config.enabled) {
            this._status = 'disabled';
            return;
        }

        this._status = 'active';
        this._interval = setInterval(() => this.runCheck(), this.config.intervalMs);
        console.log(`👁️  Watcher started: ${this.config.name} (every ${this.config.intervalMs}ms)`);
    }

    /**
     * Stop the watcher.
     */
    stop(): void {
        if (this._interval) clearInterval(this._interval);
        this._status = 'disabled';
    }

    /**
     * Pause the watcher temporarily.
     */
    pause(): void {
        this._status = 'paused';
    }

    resume(): void {
        this._status = 'active';
    }

    private async runCheck(): Promise<void> {
        if (this._status !== 'active') return;

        // Respect cooldown. (Status is provably 'active' here — line above returns while
        // 'triggered' during cooldown, and the post-alert setTimeout resets 'triggered'→'active'.)
        if (this._lastAlert) {
            const elapsed = Date.now() - this._lastAlert.getTime();
            if (elapsed < this.config.cooldownMs) return;
        }

        try {
            const result = await this.check();
            this._checkCount++;
            this._lastCheck = result.checkedAt;

            if (!result.healthy && result.alerts.length > 0) {
                this._status = 'triggered';
                this._alertCount += result.alerts.length;
                this._lastAlert = new Date();

                // TODO: Emit watcher.alert events
                // TODO: Notify channels
                // TODO: Trigger workflow if configured

                console.log(`🚨 Watcher alert: ${this.config.name} — ${result.alerts.length} alert(s)`);

                // Enter cooldown
                setTimeout(() => {
                    if (this._status === 'triggered') this._status = 'active';
                }, this.config.cooldownMs);
            }
        } catch (err) {
            console.error(`Watcher check failed: ${this.config.name}`, err);
        }
    }
}

// ---------------------------------------------------------------------------
// Built-in Watchers
// ---------------------------------------------------------------------------

/**
 * Drift watcher — detects configuration or state drift.
 */
export class DriftWatcher extends BaseWatcher {
    constructor(config: Omit<WatcherConfig, 'type'>) {
        super({ ...config, type: 'drift' });
    }

    async check(): Promise<WatcherCheckResult> {
        const start = Date.now();
        const alerts: WatcherAlert[] = [];

        // TODO: Compare current state against expected state
        // - Git config drift
        // - Infrastructure drift (Terraform state)
        // - Worker config drift (YAML vs running)
        // - Policy drift (defined vs enforced)

        return {
            healthy: alerts.length === 0,
            alerts,
            metrics: { driftDetected: alerts.length },
            checkedAt: new Date(),
            durationMs: Date.now() - start,
        };
    }
}

/**
 * Cost watcher — monitors LLM and compute spend.
 */
export class CostWatcher extends BaseWatcher {
    constructor(config: Omit<WatcherConfig, 'type'>) {
        super({ ...config, type: 'cost' });
    }

    async check(): Promise<WatcherCheckResult> {
        const start = Date.now();
        const alerts: WatcherAlert[] = [];
        const threshold = (this.config.params.maxHourlyCostUsd as number) ?? 100;

        // TODO: Query cost metrics from the model router
        const currentHourlyCost = 0; // placeholder

        if (currentHourlyCost > threshold) {
            alerts.push({
                id: crypto.randomUUID(),
                watcherId: this.config.id,
                watcherName: this.config.name,
                type: 'cost',
                severity: currentHourlyCost > threshold * 2 ? 'critical' : 'warning',
                title: 'LLM cost threshold exceeded',
                description: `Current hourly cost $${currentHourlyCost.toFixed(2)} exceeds threshold $${threshold}`,
                detectedAt: new Date(),
                metrics: { currentCost: currentHourlyCost, threshold },
                context: {},
                remediationSuggested: 'Switch to cost-first routing strategy',
            });
        }

        return {
            healthy: alerts.length === 0,
            alerts,
            metrics: { hourlyCostUsd: currentHourlyCost, threshold },
            checkedAt: new Date(),
            durationMs: Date.now() - start,
        };
    }
}

/**
 * Compliance watcher — ensures policies are being enforced.
 */
export class ComplianceWatcher extends BaseWatcher {
    constructor(config: Omit<WatcherConfig, 'type'>) {
        super({ ...config, type: 'compliance' });
    }

    async check(): Promise<WatcherCheckResult> {
        const start = Date.now();
        const alerts: WatcherAlert[] = [];

        // TODO: Audit recent tool invocations against policy
        // TODO: Check for unapproved high-risk actions
        // TODO: Verify data residency compliance
        // TODO: Check secret rotation freshness

        return {
            healthy: alerts.length === 0,
            alerts,
            metrics: { violationsDetected: 0 },
            checkedAt: new Date(),
            durationMs: Date.now() - start,
        };
    }
}

/**
 * Performance watcher — monitors worker health and throughput.
 */
export class PerformanceWatcher extends BaseWatcher {
    constructor(config: Omit<WatcherConfig, 'type'>) {
        super({ ...config, type: 'performance' });
    }

    async check(): Promise<WatcherCheckResult> {
        const start = Date.now();
        const alerts: WatcherAlert[] = [];

        // TODO: Check worker error rates
        // TODO: Check task queue depth
        // TODO: Check average task latency
        // TODO: Check stuck worker count

        return {
            healthy: alerts.length === 0,
            alerts,
            metrics: {},
            checkedAt: new Date(),
            durationMs: Date.now() - start,
        };
    }
}

// ---------------------------------------------------------------------------
// Watcher Manager
// ---------------------------------------------------------------------------

export class WatcherManager {
    private watchers = new Map<string, BaseWatcher>();

    register(watcher: BaseWatcher): void {
        this.watchers.set(watcher.config.id, watcher);
    }

    startAll(): void {
        for (const watcher of this.watchers.values()) {
            watcher.start();
        }
        console.log(`👁️  ${this.watchers.size} watchers started`);
    }

    stopAll(): void {
        for (const watcher of this.watchers.values()) {
            watcher.stop();
        }
    }

    getWatcher(id: string): BaseWatcher | undefined {
        return this.watchers.get(id);
    }

    getAllStats() {
        return Array.from(this.watchers.values()).map((w) => ({
            id: w.config.id,
            name: w.config.name,
            type: w.config.type,
            status: w.status,
            ...w.stats,
        }));
    }
}
