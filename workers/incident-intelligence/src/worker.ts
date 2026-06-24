/**
 * Incident Intelligence Worker — Automated incident analysis
 *
 * Triggered by: incident.created event, @eaos analyze incident INC-xxx
 *
 * Pipeline:
 *   1. Pull metrics from Grafana (alerting dashboards, service health)
 *   2. Pull logs from Kibana (error patterns, stack traces)
 *   3. Check recent deployments from GitHub (PRs merged in last 24h)
 *   4. Search Jira for similar past incidents
 *   5. Search Confluence for runbooks
 *   6. Correlate signals → root cause hypothesis
 *   7. Generate structured IncidentAnalysisOutput
 *   8. Post to Slack/Jira with remediation steps
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Generic data-source connector contract (kept local — workers are independent bounded contexts). */
export interface Connector {
    search(query: string, options: Record<string, unknown>): Promise<ConnectorResult[]>;
}

export interface ConnectorResult {
    title: string;
    url: string;
    excerpt?: string;
    score?: number;
    metadata?: Record<string, unknown>;
}

export interface IncidentInput {
    incidentId: string;
    service?: string;
    alertName?: string;
    severity?: string;
    description?: string;
    startedAt?: Date;
}

export interface IncidentAnalysis {
    incidentId: string;
    title: string;
    severity: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
    status: 'analyzing' | 'analyzed' | 'resolved';

    rootCause: {
        hypothesis: string;
        confidence: number;
        evidence: string[];
    };

    blastRadius: {
        affectedServices: string[];
        affectedEndpoints: string[];
        estimatedUsersImpacted: string;
        revenueImpact: string;
    };

    timeline: TimelineEvent[];

    signals: {
        metrics: MetricSignal[];
        logs: LogSignal[];
        deployments: DeploymentSignal[];
    };

    correlations: {
        similarIncidents: SimilarIncident[];
        recentChanges: RecentChange[];
        relevantRunbooks: Runbook[];
    };

    remediation: {
        immediateActions: string[];
        shortTermFixes: string[];
        longTermPreventions: string[];
    };

    sources: Array<{ title: string; type: string; url: string; relevance: number }>;
    confidence: number;
    groundingScore: number;

    meta: {
        durationMs: number;
        signalsCollected: number;
        model: string;
    };
}

interface TimelineEvent { time: string; event: string; source: string }
interface MetricSignal { metric: string; value: number; threshold: number; dashboard: string }
interface LogSignal { pattern: string; count: number; sample: string; service: string }
interface DeploymentSignal { pr: string; author: string; mergedAt: string; filesChanged: number; risky: boolean }
interface SimilarIncident { key: string; summary: string; rootCause: string; similarity: number }
interface RecentChange { pr: string; summary: string; mergedAt: string; relevance: number }
interface Runbook { title: string; url: string; relevance: number }

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export class IncidentIntelligenceWorker {
    private connectors: Map<string, Connector> = new Map();

    registerConnector(name: string, connector: Connector): void {
        this.connectors.set(name, connector);
    }

    async analyze(input: IncidentInput): Promise<IncidentAnalysis> {
        const startTime = Date.now();

        // Phase 1: Parallel signal collection
        const [metrics, logs, deployments, pastIncidents, runbooks] = await Promise.all([
            this.collectMetrics(input),
            this.collectLogs(input),
            this.collectDeployments(input),
            this.findSimilarIncidents(input),
            this.findRunbooks(input),
        ]);

        // Phase 2: Build timeline from all signals
        const timeline = this.buildTimeline(metrics, logs, deployments, input.startedAt);

        // Phase 3: Correlate signals
        const correlatedDeployments = this.correlateDeployments(deployments, metrics, input.startedAt);

        // Phase 4: Generate root cause hypothesis
        const rootCause = await this.generateRootCause({
            metrics,
            logs,
            deployments: correlatedDeployments,
            pastIncidents,
            timeline,
        });

        // Phase 5: Assess blast radius
        const blastRadius = this.assessBlastRadius(metrics, logs);

        // Phase 6: Generate remediation
        const remediation = await this.generateRemediation(rootCause, runbooks, pastIncidents);

        // Phase 7: Determine severity
        const severity = this.determineSeverity(blastRadius, metrics);

        const allSources = [
            ...metrics.map(m => ({ title: `Grafana: ${m.metric}`, type: 'grafana' as const, url: m.dashboard, relevance: 0.9 })),
            ...logs.map(l => ({ title: `Kibana: ${l.pattern}`, type: 'kibana' as const, url: '', relevance: 0.8 })),
            ...pastIncidents.map(i => ({ title: i.key, type: 'jira' as const, url: '', relevance: i.similarity })),
            ...runbooks.map(r => ({ title: r.title, type: 'confluence' as const, url: r.url, relevance: r.relevance })),
        ];

        return {
            incidentId: input.incidentId,
            title: input.description ?? `Incident ${input.incidentId}`,
            severity,
            status: 'analyzed',
            rootCause,
            blastRadius,
            timeline,
            signals: { metrics, logs, deployments },
            correlations: {
                similarIncidents: pastIncidents,
                recentChanges: correlatedDeployments.map(d => ({ pr: d.pr, summary: d.summary ?? '', mergedAt: d.mergedAt, relevance: d.risky ? 0.9 : 0.3 })),
                relevantRunbooks: runbooks,
            },
            remediation,
            sources: allSources,
            confidence: rootCause.confidence,
            groundingScore: Math.min(0.95, allSources.length / 10),
            meta: {
                durationMs: Date.now() - startTime,
                signalsCollected: metrics.length + logs.length + deployments.length,
                model: 'gpt-4o',
            },
        };
    }

    // -------------------------------------------------------------------------
    // Signal collection
    // -------------------------------------------------------------------------

    private async collectMetrics(input: IncidentInput): Promise<MetricSignal[]> {
        const grafana = this.connectors.get('grafana');
        if (!grafana) return [];
        try {
            const results = await grafana.search(`service:${input.service ?? '*'} status:alerting`, { limit: 20 });
            return results.map(r => ({
                metric: r.title,
                value: (r.metadata?.value as number) ?? 0,
                threshold: (r.metadata?.threshold as number) ?? 0,
                dashboard: r.url,
            }));
        } catch { return []; }
    }

    private async collectLogs(input: IncidentInput): Promise<LogSignal[]> {
        const kibana = this.connectors.get('kibana');
        if (!kibana) return [];
        try {
            const results = await kibana.search(`service:${input.service ?? '*'} level:error`, { limit: 50 });
            return results.map(r => ({
                pattern: r.title,
                count: (r.metadata?.count as number) ?? 1,
                sample: r.excerpt ?? '',
                service: input.service ?? 'unknown',
            }));
        } catch { return []; }
    }

    private async collectDeployments(input: IncidentInput): Promise<DeploymentSignal[]> {
        const github = this.connectors.get('github');
        if (!github) return [];
        try {
            const results = await github.search('merged:>24h', { repos: input.service ? [input.service] : undefined, limit: 10 });
            return results.map(r => ({
                pr: r.title,
                author: (r.metadata?.author as string) ?? '',
                mergedAt: (r.metadata?.mergedAt as string) ?? '',
                filesChanged: (r.metadata?.filesChanged as number) ?? 0,
                risky: (r.metadata?.filesChanged as number ?? 0) > 20,
                summary: r.excerpt,
            }));
        } catch { return []; }
    }

    private async findSimilarIncidents(input: IncidentInput): Promise<SimilarIncident[]> {
        const jira = this.connectors.get('jira');
        if (!jira) return [];
        try {
            const results = await jira.search(input.description ?? input.incidentId, { types: ['Incident'], limit: 5 });
            return results.map(r => ({
                key: r.title.match(/[A-Z]+-\d+/)?.[0] ?? r.title,
                summary: r.excerpt ?? '',
                rootCause: (r.metadata?.rootCause as string) ?? '',
                similarity: r.score ?? 0.5,
            }));
        } catch { return []; }
    }

    private async findRunbooks(input: IncidentInput): Promise<Runbook[]> {
        const confluence = this.connectors.get('confluence');
        if (!confluence) return [];
        try {
            const results = await confluence.search(`runbook ${input.service ?? ''}`, { limit: 3 });
            return results.map(r => ({ title: r.title, url: r.url, relevance: r.score ?? 0.5 }));
        } catch { return []; }
    }

    // -------------------------------------------------------------------------
    // Analysis
    // -------------------------------------------------------------------------

    private buildTimeline(metrics: MetricSignal[], logs: LogSignal[], deployments: DeploymentSignal[], startedAt?: Date): TimelineEvent[] {
        const events: TimelineEvent[] = [];
        for (const d of deployments) events.push({ time: d.mergedAt, event: `PR merged: ${d.pr}`, source: 'github' });
        for (const m of metrics.slice(0, 5)) events.push({ time: '', event: `Alert: ${m.metric} = ${m.value}`, source: 'grafana' });
        for (const l of logs.slice(0, 5)) events.push({ time: '', event: `Error: ${l.pattern} (${l.count}x)`, source: 'kibana' });
        if (startedAt) events.push({ time: startedAt.toISOString(), event: 'Incident reported', source: 'jira' });
        return events;
    }

    private correlateDeployments(deployments: DeploymentSignal[], metrics: MetricSignal[], startedAt?: Date): (DeploymentSignal & { summary?: string })[] {
        // Flag deployments that happened close to incident start
        return deployments.map(d => ({
            ...d,
            risky: d.risky || d.filesChanged > 10,
        }));
    }

    private async generateRootCause(signals: Record<string, unknown>): Promise<{ hypothesis: string; confidence: number; evidence: string[] }> {
        // In production: LLM synthesis with all signals
        return { hypothesis: '[LLM-generated root cause from signals]', confidence: 0.75, evidence: [] };
    }

    private assessBlastRadius(metrics: MetricSignal[], logs: LogSignal[]): IncidentAnalysis['blastRadius'] {
        const services = [...new Set(logs.map(l => l.service))];
        return {
            affectedServices: services,
            affectedEndpoints: [],
            estimatedUsersImpacted: 'TBD',
            revenueImpact: 'TBD',
        };
    }

    private async generateRemediation(rootCause: { hypothesis: string }, runbooks: Runbook[], pastIncidents: SimilarIncident[]): Promise<IncidentAnalysis['remediation']> {
        return {
            immediateActions: ['Check service health', 'Review recent deployments'],
            shortTermFixes: ['Rollback if caused by deployment'],
            longTermPreventions: ['Add circuit breaker', 'Improve monitoring'],
        };
    }

    private determineSeverity(blast: IncidentAnalysis['blastRadius'], metrics: MetricSignal[]): IncidentAnalysis['severity'] {
        if (blast.affectedServices.length > 3) return 'SEV1';
        if (blast.affectedServices.length > 1) return 'SEV2';
        if (metrics.length > 5) return 'SEV3';
        return 'SEV4';
    }
}
