/**
 * Pipeline Engine — DAG-based Agent Pipeline Executor
 *
 * Reads the agent graph configuration and executes agents in dependency order
 * with quality gates, retry logic, feedback loops, checkpoints, and status
 * reporting. This is the runtime that makes the marketing (and future)
 * agent pipelines actually execute.
 *
 * Integration points:
 * - llm-provider.ts    → LLM calls for agent execution
 * - event-bus.ts       → Lifecycle event publication
 * - prompt-builder.ts  → Multi-layer prompt assembly
 * - plugin-interfaces  → Extensible runtime/tool/LLM plugins
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { callLLM as callLLMProvider, type LLMProviderId } from './llm-provider.js';
import { eventBus } from './event-bus.js';
import { buildPrompt, type PromptContext } from './prompt-builder.js';
import { WorkflowStore } from '@agentos/db/workflow-store';
import type { Store } from '@agentos/db';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type PipelineStatus = 'initializing' | 'running' | 'waiting_approval' | 'retrying' | 'completed' | 'failed' | 'paused' | 'cancelled';
export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'retrying' | 'skipped' | 'blocked';
export type GateResult = 'passed' | 'failed' | 'retrying';

/** Graph node definition (from graph.json) */
export interface GraphNode {
    id: string;
    agent: string;
    depends_on: string[];
    phase: string;
    parallel_group: string | null;
}

/** Quality gate definition (from graph.json) */
export interface QualityGate {
    id: string;
    after_node: string;
    validation: Record<string, unknown>;
    on_fail: 'retry' | 'block' | 'skip';
    max_retries: number;
    retry_instructions?: string;
    type?: string;
}

/** Checkpoint definition (from graph.json) */
export interface Checkpoint {
    id: string;
    before_node?: string;
    within_node?: string;
    after_gate?: string;
    type: 'human_approval' | 'conditional_approval';
    description: string;
    timeout_hours?: number;
    on_timeout?: 'escalate' | 'block';
    escalation_target?: string;
    condition?: string;
    auto_approve_below?: number;
    requires_fields?: string[];
}

/** Feedback loop definition (from graph.json) */
export interface FeedbackLoop {
    id: string;
    from: string;
    to: string[];
    trigger: {
        condition: string;
        thresholds: Record<string, number>;
        minimum_data_window_hours?: number;
    };
    actions: Record<string, string>;
    max_loop_iterations: number;
    cooldown_hours: number;
    circuit_breaker?: {
        pause_if: string;
        action: string;
    };
}

/** Execution config (from graph.json) */
export interface ExecutionConfig {
    parallel_execution: boolean;
    max_concurrent_agents: number;
    global_timeout_minutes: number;
    per_node_timeout_minutes: number;
    retry_backoff_multiplier: number;
    status_reporting_interval_seconds: number;
}

/** Full graph configuration (loaded from graph.json) */
export interface GraphConfig {
    graph_id: string;
    name: string;
    nodes: GraphNode[];
    phases: Record<string, { label: string; order: number; description: string }>;
    quality_gates: QualityGate[];
    checkpoints: Checkpoint[];
    feedback_loops: FeedbackLoop[];
    shared_state: Record<string, { written_by: string; read_by: string[]; schema?: string }>;
    execution_config: ExecutionConfig;
}

/** Agent definition loaded from agent JSON files */
export interface AgentDefinition {
    agent_id: string;
    name: string;
    type: string;
    system_prompt: string;
    identity?: Record<string, unknown>;
    mission?: string[];
    critical_rules?: string[];
    workflow?: Record<string, unknown>;
    quality_gates?: Array<{ gate: string; criteria: string }>;
    handoff_output_schema?: Array<{ field: string; type: string; description: string }>;
}

/** Orchestrator config loaded from orchestrator agent.json */
export interface OrchestratorConfig {
    agent_id: string;
    intent_routing: Record<string, {
        description: string;
        entry_node: string;
        graph: string;
        phases: string[];
        terminal_node?: string;
        requires_state?: string[];
    }>;
    pipeline_execution: Record<string, unknown>;
    escalation_rules: Array<{
        condition: string;
        action: string;
        notify: string[];
        message_template: string;
    }>;
    system_prompt: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Node Execution State
// ═══════════════════════════════════════════════════════════════════════════

interface NodeState {
    nodeId: string;
    status: NodeStatus;
    retryCount: number;
    output: string | null;
    error: string | null;
    startedAt: string | null;
    completedAt: string | null;
    qualityGateResult: GateResult | null;
    durationMs: number;
    tokensUsed: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pipeline Execution
// ═══════════════════════════════════════════════════════════════════════════

export interface PipelineExecution {
    id: string;
    graphId: string;
    intent: string;
    status: PipelineStatus;
    nodeStates: Map<string, NodeState>;
    sharedState: Map<string, unknown>;
    feedbackLoopCounts: Map<string, number>;
    startedAt: string;
    completedAt: string | null;
    totalTokensUsed: number;
    totalCostUsd: number;
    statusReports: string[];
    afterActionReport: string | null;
}

/** Active pipeline executions */
const pipelineExecutions = new Map<string, PipelineExecution>();

// ---------------------------------------------------------------------------
// Persistent workflow store — survives gateway restarts
// ---------------------------------------------------------------------------

let _workflowStore: WorkflowStore | null = null;

/** Call from server.ts after the gateway store is initialised. */
export async function initWorkflowStore(store: Store): Promise<void> {
  _workflowStore = new WorkflowStore(store);
  // Rehydrate any previously saved executions that are not yet terminal
  for (const snapshot of await _workflowStore.list(200)) {
    if (snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled') continue;
    const exec = _workflowStore.rehydrate(snapshot) as unknown as PipelineExecution;
    // Mark interrupted executions as failed so they don't appear stuck
    exec.status = 'failed';
    pipelineExecutions.set(exec.id, exec);
  }
}

function persistPipeline(exec: PipelineExecution): void {
  _workflowStore?.save(exec as Parameters<WorkflowStore['save']>[0]);
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper — LLM call through multi-provider system
// ═══════════════════════════════════════════════════════════════════════════

async function llmCall(
    systemPrompt: string,
    userPrompt: string,
    options?: { provider?: LLMProviderId; model?: string; maxTokens?: number; temperature?: number }
): Promise<{ content: string; inputTokens: number; outputTokens: number; cost: number }> {
    const response = await callLLMProvider({
        provider: options?.provider,
        model: options?.model,
        systemPrompt,
        userPrompt,
        maxTokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
    });
    return {
        content: response.content,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        cost: response.cost,
    };
}

function parseLLMJson<T>(content: string): T | null {
    if (!content) return null;
    let cleaned = content.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();
    try { return JSON.parse(cleaned) as T; } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// Core Pipeline Engine
// ═══════════════════════════════════════════════════════════════════════════

export class PipelineEngine {
    private graph: GraphConfig;
    private orchestrator: OrchestratorConfig;
    private agentDefs: Map<string, AgentDefinition>;
    private checkpointResolver: CheckpointResolver;

    constructor(
        graph: GraphConfig,
        orchestrator: OrchestratorConfig,
        agentDefs: Map<string, AgentDefinition>,
        checkpointResolver?: CheckpointResolver,
    ) {
        this.graph = graph;
        this.orchestrator = orchestrator;
        this.agentDefs = agentDefs;
        this.checkpointResolver = checkpointResolver ?? defaultCheckpointResolver;
    }

    // -----------------------------------------------------------------------
    // Execute a full pipeline
    // -----------------------------------------------------------------------

    async execute(
        intent: string,
        userContext?: Record<string, unknown>,
        options?: { provider?: LLMProviderId; model?: string; userId?: string }
    ): Promise<PipelineExecution> {
        const pipelineId = `pipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // Resolve intent to routing config
        const route = this.resolveIntent(intent);
        const activeNodes = this.resolveActiveNodes(route);

        // Initialize pipeline execution
        const execution: PipelineExecution = {
            id: pipelineId,
            graphId: this.graph.graph_id,
            intent,
            status: 'initializing',
            nodeStates: new Map(),
            sharedState: new Map(),
            feedbackLoopCounts: new Map(),
            startedAt: new Date().toISOString(),
            completedAt: null,
            totalTokensUsed: 0,
            totalCostUsd: 0,
            statusReports: [],
            afterActionReport: null,
        };

        // Initialize node states
        for (const node of activeNodes) {
            execution.nodeStates.set(node.id, {
                nodeId: node.id,
                status: 'pending',
                retryCount: 0,
                output: null,
                error: null,
                startedAt: null,
                completedAt: null,
                qualityGateResult: null,
                durationMs: 0,
                tokensUsed: 0,
            });
        }

        // Inject user context into shared state
        if (userContext) {
            execution.sharedState.set('state.user_context', userContext);
        }

        pipelineExecutions.set(pipelineId, execution);
        persistPipeline(execution);
        execution.status = 'running';
        await eventBus.emit('pipeline.started', { pipelineId, intent, nodeCount: activeNodes.length });

        // Execute the DAG
        try {
            await this.executeDAG(execution, activeNodes, options);
            if (execution.status as PipelineStatus === 'cancelled') return execution;
            if (!execution.nodeStates.size || [...execution.nodeStates.values()].some(node => node.status !== 'completed')) throw new Error('Pipeline did not complete every required node');

            // Generate after-action report
            execution.afterActionReport = await this.generateAAR(execution);
            execution.status = 'completed';
            execution.completedAt = new Date().toISOString();
            await eventBus.emit('pipeline.completed', {
                pipelineId,
                totalTokens: execution.totalTokensUsed,
                totalCost: execution.totalCostUsd,
                durationMs: Date.now() - new Date(execution.startedAt).getTime(),
            });
        } catch (err) {
            if (execution.status as PipelineStatus !== 'cancelled') execution.status = 'failed';
            execution.completedAt = new Date().toISOString();
            await eventBus.emit('pipeline.failed', {
                pipelineId,
                error: err instanceof Error ? err.message : String(err),
            });
        }

        pipelineExecutions.set(pipelineId, execution);
        persistPipeline(execution);
        return execution;
    }

    // -----------------------------------------------------------------------
    // Intent Resolution
    // -----------------------------------------------------------------------

    private resolveIntent(intent: string): { entry: string; terminal?: string; phases: string[]; requiresState: string[] } {
        const lower = intent.toLowerCase();

        for (const [, route] of Object.entries(this.orchestrator.intent_routing)) {
            const keywords = route.description.toLowerCase().split(/\s+/);
            const matchScore = keywords.filter(k => lower.includes(k)).length;
            if (matchScore >= 2) {
                return {
                    entry: route.entry_node,
                    terminal: route.terminal_node,
                    phases: route.phases,
                    requiresState: route.requires_state ?? [],
                };
            }
        }

        // Default: full pipeline
        return { entry: 'research', phases: Object.keys(this.graph.phases), requiresState: [] };
    }

    private resolveActiveNodes(route: { entry: string; terminal?: string; phases: string[] }): GraphNode[] {
        // Filter nodes by active phases
        const phaseSet = new Set(route.phases);
        let nodes = this.graph.nodes.filter(n => phaseSet.has(n.phase));

        // If terminal node specified, trim the graph
        if (route.terminal) {
            const terminalIdx = nodes.findIndex(n => n.id === route.terminal);
            if (terminalIdx >= 0) {
                nodes = nodes.slice(0, terminalIdx + 1);
            }
        }

        return nodes;
    }

    // -----------------------------------------------------------------------
    // DAG Executor — Topological execution with parallelism
    // -----------------------------------------------------------------------

    private async executeDAG(
        execution: PipelineExecution,
        nodes: GraphNode[],
        options?: { provider?: LLMProviderId; model?: string }
    ): Promise<void> {
        const completed = new Set<string>();
        const config = this.graph.execution_config;
        const globalDeadline = Date.now() + config.global_timeout_minutes * 60 * 1000;

        while (completed.size < nodes.length) {
            // Global timeout check
            if (Date.now() > globalDeadline) {
                await this.escalate(execution, 'Pipeline exceeded global timeout', 'pause_pipeline');
                throw new Error(`Pipeline exceeded global timeout of ${config.global_timeout_minutes} minutes`);
            }

            // Find runnable nodes (all dependencies completed)
            const runnable = nodes.filter(
                n => !completed.has(n.id) &&
                     execution.nodeStates.get(n.id)?.status !== 'failed' &&
                     execution.nodeStates.get(n.id)?.status !== 'blocked' &&
                     n.depends_on.every(dep => completed.has(dep))
            );

            if (runnable.length === 0) {
                // Check if we're stuck
                const pending = nodes.filter(n => !completed.has(n.id));
                const allBlockedOrFailed = pending.every(n => {
                    const state = execution.nodeStates.get(n.id);
                    return state?.status === 'failed' || state?.status === 'blocked';
                });

                if (allBlockedOrFailed || pending.length === 0) break;

                // Truly stuck — no runnable nodes but not all failed/blocked
                await this.escalate(execution, 'Pipeline stuck: no runnable nodes', 'block_pipeline');
                throw new Error('Pipeline stuck: unresolvable dependency cycle or blocked nodes');
            }

            // Execute in parallel groups (respecting max_concurrent)
            const batches = this.batchByParallelGroup(runnable, config.max_concurrent_agents);

            for (const batch of batches) {
                const results = await Promise.allSettled(
                    batch.map(node => this.executeNode(execution, node, options))
                );

                for (let i = 0; i < batch.length; i++) {
                    const node = batch[i];
                    const result = results[i];

                    if (result.status === 'fulfilled' && result.value) {
                        completed.add(node.id);
                    }
                    // Failed nodes are handled inside executeNode (retry/escalate)
                }
            }

            // Report status
            execution.statusReports.push(this.generateStatusReport(execution, nodes));
        }
    }

    private batchByParallelGroup(nodes: GraphNode[], maxConcurrent: number): GraphNode[][] {
        const batches: GraphNode[][] = [];
        const groups = new Map<string | null, GraphNode[]>();

        for (const node of nodes) {
            const group = node.parallel_group;
            if (!groups.has(group)) groups.set(group, []);
            groups.get(group)!.push(node);
        }

        // Nodes in the same parallel_group run together; null runs solo
        for (const [group, groupNodes] of groups) {
            if (group === null) {
                for (const node of groupNodes) {
                    batches.push([node]);
                }
            } else {
                // Batch parallel group respecting max concurrent
                for (let i = 0; i < groupNodes.length; i += maxConcurrent) {
                    batches.push(groupNodes.slice(i, i + maxConcurrent));
                }
            }
        }

        return batches;
    }

    // -----------------------------------------------------------------------
    // Node Executor — Single agent execution with quality gate
    // -----------------------------------------------------------------------

    private async executeNode(
        execution: PipelineExecution,
        node: GraphNode,
        options?: { provider?: LLMProviderId; model?: string }
    ): Promise<boolean> {
        const nodeState = execution.nodeStates.get(node.id)!;
        const agentDef = this.agentDefs.get(node.agent);

        if (!agentDef) {
            nodeState.status = 'failed';
            nodeState.error = `Agent definition not found: ${node.agent}`;
            return false;
        }

        // Check for checkpoint before this node
        await this.handleCheckpoint(execution, node, 'before');

        nodeState.status = 'running';
        nodeState.startedAt = new Date().toISOString();
        await eventBus.emit('node.started', { pipelineId: execution.id, nodeId: node.id, agent: node.agent });

        // Gather shared state context for this node
        const stateContext = this.gatherNodeContext(execution, node);

        // Build prompt using the 4-layer prompt builder
        const promptContext: PromptContext = {
            agentDefinition: agentDef,
            sharedState: stateContext,
            pipelineIntent: execution.intent,
            previousOutputs: this.getPreviousOutputs(execution, node),
        };

        const { systemPrompt, userPrompt } = buildPrompt(promptContext);

        try {
            const nodeDeadline = Date.now() + this.graph.execution_config.per_node_timeout_minutes * 60 * 1000;

            const result = await llmCall(systemPrompt, userPrompt, {
                provider: options?.provider,
                model: options?.model,
                maxTokens: 4096,
            });

            if (Date.now() > nodeDeadline) {
                nodeState.status = 'failed';
                nodeState.error = 'Node execution exceeded timeout';
                return false;
            }

            nodeState.output = result.content;
            nodeState.tokensUsed = result.inputTokens + result.outputTokens;
            execution.totalTokensUsed += nodeState.tokensUsed;
            execution.totalCostUsd += result.cost;

            // Write to shared state
            this.writeSharedState(execution, node, result.content);

            // Run quality gate
            const gateResult = await this.runQualityGate(execution, node, result.content, options);
            nodeState.qualityGateResult = gateResult;

            if (gateResult === 'passed') {
                nodeState.status = 'completed';
                nodeState.completedAt = new Date().toISOString();
                nodeState.durationMs = Date.now() - new Date(nodeState.startedAt!).getTime();
                await eventBus.emit('node.completed', {
                    pipelineId: execution.id,
                    nodeId: node.id,
                    tokens: nodeState.tokensUsed,
                    duration: nodeState.durationMs,
                });
                return true;
            }

            if (gateResult === 'retrying') {
                return await this.retryNode(execution, node, options);
            }

            // Gate failed hard — block
            nodeState.status = 'blocked';
            await this.escalate(execution, `Quality gate failed for node ${node.id}`, 'block_pipeline');
            return false;

        } catch (err) {
            nodeState.status = 'failed';
            nodeState.error = err instanceof Error ? err.message : String(err);
            nodeState.completedAt = new Date().toISOString();
            nodeState.durationMs = Date.now() - new Date(nodeState.startedAt!).getTime();

            await eventBus.emit('node.failed', {
                pipelineId: execution.id,
                nodeId: node.id,
                error: nodeState.error,
            });

            return false;
        }
    }

    // -----------------------------------------------------------------------
    // Quality Gates
    // -----------------------------------------------------------------------

    private async runQualityGate(
        execution: PipelineExecution,
        node: GraphNode,
        output: string,
        options?: { provider?: LLMProviderId; model?: string }
    ): Promise<GateResult> {
        const gate = this.graph.quality_gates.find(g => g.after_node === node.id);
        if (!gate) return 'passed'; // No gate = auto-pass

        const nodeState = execution.nodeStates.get(node.id)!;

        // Use LLM to validate output against gate criteria
        const validationPrompt = `You are a quality gate validator. Evaluate the following output against the validation criteria.

Validation criteria:
${JSON.stringify(gate.validation, null, 2)}

Output to validate:
${output.slice(0, 3000)}

Return JSON:
{
  "passed": true/false,
  "missing_sections": ["list of missing required sections"],
  "issues": ["list of specific issues found"],
  "score": 0.0 to 1.0
}`;

        try {
            const result = await llmCall(
                'You are a strict quality gate validator. Return only valid JSON. Never pass substandard work.',
                validationPrompt,
                { provider: options?.provider, model: options?.model, maxTokens: 1024, temperature: 0.2 },
            );

            const validation = parseLLMJson<{ passed: boolean; missing_sections: string[]; issues: string[]; score: number }>(result.content);
            execution.totalTokensUsed += result.inputTokens + result.outputTokens;
            execution.totalCostUsd += result.cost;

            if (validation?.passed === true && typeof validation.score === 'number' && Number.isFinite(validation.score) && validation.score >= 0.7 && validation.score <= 1 && Array.isArray(validation.missing_sections) && validation.missing_sections.length === 0 && Array.isArray(validation.issues)) {
                await eventBus.emit('gate.passed', { pipelineId: execution.id, gateId: gate.id, score: validation.score });
                return 'passed';
            }

            // Gate failed
            await eventBus.emit('gate.failed', {
                pipelineId: execution.id,
                gateId: gate.id,
                issues: validation?.issues ?? ['Validation failed'],
                score: validation?.score ?? 0,
            });

            if (gate.on_fail === 'retry' && nodeState.retryCount < gate.max_retries) {
                return 'retrying';
            }

            if (gate.on_fail === 'skip') {
                return 'failed'; // A skipped validation cannot certify the node
            }

            return 'failed';
        } catch {
            // An unavailable evaluator cannot certify a quality gate
            await eventBus.emit('gate.error', { pipelineId: execution.id, gateId: gate.id, error: 'Gate validation LLM call failed' });
            return 'failed';
        }
    }

    // -----------------------------------------------------------------------
    // Retry Logic
    // -----------------------------------------------------------------------

    private async retryNode(
        execution: PipelineExecution,
        node: GraphNode,
        options?: { provider?: LLMProviderId; model?: string }
    ): Promise<boolean> {
        const nodeState = execution.nodeStates.get(node.id)!;
        const gate = this.graph.quality_gates.find(g => g.after_node === node.id);

        if (!gate || nodeState.retryCount >= gate.max_retries) {
            nodeState.status = 'failed';
            nodeState.error = `Exhausted ${gate?.max_retries ?? 0} retries`;
            await this.escalate(execution, `Node ${node.id} failed after ${nodeState.retryCount} retries`, 'block_pipeline');
            return false;
        }

        nodeState.retryCount++;
        nodeState.status = 'retrying';

        // Exponential backoff
        const backoffMs = 1000 * Math.pow(this.graph.execution_config.retry_backoff_multiplier, nodeState.retryCount - 1);
        await new Promise(resolve => setTimeout(resolve, backoffMs));

        await eventBus.emit('node.retrying', {
            pipelineId: execution.id,
            nodeId: node.id,
            attempt: nodeState.retryCount,
            maxRetries: gate.max_retries,
        });

        // Re-execute with retry instructions appended
        return await this.executeNode(execution, node, options);
    }

    // -----------------------------------------------------------------------
    // Checkpoint Handling
    // -----------------------------------------------------------------------

    private async handleCheckpoint(
        execution: PipelineExecution,
        node: GraphNode,
        position: 'before' | 'within'
    ): Promise<void> {
        const checkpoint = this.graph.checkpoints.find(cp => {
            if (position === 'before') return cp.before_node === node.id;
            return cp.within_node === node.id;
        });

        if (!checkpoint) return;

        // Conditional approval — check if condition met
        if (checkpoint.type === 'conditional_approval' && checkpoint.condition && checkpoint.auto_approve_below !== undefined) {
            // For budget shifts, check the threshold
            const conditionMet = this.evaluateCheckpointCondition(execution, checkpoint);
            if (!conditionMet) return; // Auto-approved
        }

        execution.status = 'waiting_approval';
        await eventBus.emit('checkpoint.reached', {
            pipelineId: execution.id,
            checkpointId: checkpoint.id,
            description: checkpoint.description,
            nodeId: node.id,
        });

        // Resolve checkpoint (human approval, timeout, etc.)
        const approved = await this.checkpointResolver(checkpoint, execution);

        if (!approved) {
            const nodeState = execution.nodeStates.get(node.id)!;
            nodeState.status = 'blocked';
            throw new Error(`Checkpoint '${checkpoint.id}' rejected or timed out`);
        }

        execution.status = 'running';
        await eventBus.emit('checkpoint.approved', {
            pipelineId: execution.id,
            checkpointId: checkpoint.id,
        });
    }

    private evaluateCheckpointCondition(execution: PipelineExecution, checkpoint: Checkpoint): boolean {
        // Simple condition evaluation — can be extended with a proper expression parser
        if (checkpoint.condition === 'budget_shift_percent > 30') {
            const optimizationActions = execution.sharedState.get('state.optimization_actions') as Record<string, unknown> | undefined;
            const budgetShift = (optimizationActions as Record<string, number> | undefined)?.budget_shift_percent ?? 0;
            return budgetShift > (checkpoint.auto_approve_below ?? 30);
        }
        return true; // Default: require approval
    }

    // -----------------------------------------------------------------------
    // Feedback Loops
    // -----------------------------------------------------------------------

    async evaluateFeedbackLoops(execution: PipelineExecution, options?: { provider?: LLMProviderId; model?: string }): Promise<void> {
        for (const loop of this.graph.feedback_loops) {
            const fromState = execution.nodeStates.get(loop.from);
            if (!fromState || fromState.status !== 'completed') continue;

            // Check iteration limit
            const loopCount = execution.feedbackLoopCounts.get(loop.id) ?? 0;
            if (loopCount >= loop.max_loop_iterations) {
                // Circuit breaker
                if (loop.circuit_breaker) {
                    await this.escalate(execution, `Feedback loop ${loop.id} hit circuit breaker: ${loop.circuit_breaker.action}`, 'pause_campaigns');
                }
                continue;
            }

            // Check if trigger conditions are met
            const triggerMet = this.evaluateLoopTrigger(execution, loop);
            if (!triggerMet) continue;

            // Increment loop count
            execution.feedbackLoopCounts.set(loop.id, loopCount + 1);

            await eventBus.emit('feedback_loop.triggered', {
                pipelineId: execution.id,
                loopId: loop.id,
                iteration: loopCount + 1,
                maxIterations: loop.max_loop_iterations,
            });

            // Re-queue target nodes with optimization context
            for (const targetId of loop.to) {
                const targetState = execution.nodeStates.get(targetId);
                if (!targetState) continue;

                targetState.status = 'pending';
                targetState.retryCount = 0;
                targetState.output = null;

                // Inject optimization action into shared state
                const actionInstruction = loop.actions[targetId];
                if (actionInstruction) {
                    execution.sharedState.set(`state.feedback_instruction.${targetId}`, actionInstruction);
                }
            }

            // Re-execute affected nodes
            const targetNodes = this.graph.nodes.filter(n => loop.to.includes(n.id));
            await this.executeDAG(execution, targetNodes, options);
        }
    }

    private evaluateLoopTrigger(execution: PipelineExecution, loop: FeedbackLoop): boolean {
        const analytics = execution.sharedState.get('state.analytics') as Record<string, number> | undefined;
        if (!analytics) return false;

        const thresholds = loop.trigger.thresholds;

        for (const [key, threshold] of Object.entries(thresholds)) {
            const actual = analytics[key];
            if (actual === undefined) continue;

            // Check "below" thresholds
            if (key.includes('below') && actual < threshold) return true;
            // Check "above" thresholds
            if (key.includes('above') && actual > threshold) return true;
            // Check "decline" thresholds
            if (key.includes('decline') && actual > threshold) return true;
        }

        return false;
    }

    // -----------------------------------------------------------------------
    // Shared State
    // -----------------------------------------------------------------------

    private gatherNodeContext(execution: PipelineExecution, node: GraphNode): Record<string, unknown> {
        const context: Record<string, unknown> = {};

        for (const [stateKey, stateConfig] of Object.entries(this.graph.shared_state)) {
            if (stateConfig.read_by.includes(node.id)) {
                const value = execution.sharedState.get(stateKey);
                if (value !== undefined) {
                    context[stateKey] = value;
                }
            }
        }

        // Also include any feedback instructions for this node
        const feedbackInstruction = execution.sharedState.get(`state.feedback_instruction.${node.id}`);
        if (feedbackInstruction) {
            context['feedback_instruction'] = feedbackInstruction;
        }

        return context;
    }

    private writeSharedState(execution: PipelineExecution, node: GraphNode, output: string): void {
        for (const [stateKey, stateConfig] of Object.entries(this.graph.shared_state)) {
            if (stateConfig.written_by === node.id) {
                execution.sharedState.set(stateKey, output);
            }
        }
    }

    private getPreviousOutputs(execution: PipelineExecution, node: GraphNode): Record<string, string> {
        const outputs: Record<string, string> = {};
        for (const depId of node.depends_on) {
            const depState = execution.nodeStates.get(depId);
            if (depState?.output) {
                outputs[depId] = depState.output;
            }
        }
        return outputs;
    }

    // -----------------------------------------------------------------------
    // Status Reporting
    // -----------------------------------------------------------------------

    private generateStatusReport(execution: PipelineExecution, nodes: GraphNode[]): string {
        const currentPhases = new Set<string>();
        const completedNodes: string[] = [];
        const activeNodes: string[] = [];
        const pendingNodes: string[] = [];
        const failedNodes: string[] = [];

        for (const node of nodes) {
            const state = execution.nodeStates.get(node.id);
            if (!state) continue;
            switch (state.status) {
                case 'completed': completedNodes.push(node.id); break;
                case 'running': activeNodes.push(node.id); currentPhases.add(node.phase); break;
                case 'pending': pendingNodes.push(node.id); break;
                case 'failed':
                case 'blocked': failedNodes.push(node.id); break;
            }
        }

        const elapsed = Date.now() - new Date(execution.startedAt).getTime();
        const progress = nodes.length > 0 ? Math.round((completedNodes.length / nodes.length) * 100) : 0;

        return [
            `=== Pipeline Status Report ===`,
            `Pipeline: ${execution.id}`,
            `Progress: ${progress}% (${completedNodes.length}/${nodes.length} nodes)`,
            `Phase: ${[...currentPhases].join(', ') || 'transitioning'}`,
            `Completed: [${completedNodes.join(', ')}]`,
            `Active: [${activeNodes.join(', ')}]`,
            `Pending: [${pendingNodes.join(', ')}]`,
            failedNodes.length > 0 ? `Failed: [${failedNodes.join(', ')}]` : '',
            `Tokens: ${execution.totalTokensUsed} | Cost: $${execution.totalCostUsd.toFixed(4)}`,
            `Elapsed: ${Math.round(elapsed / 1000)}s`,
        ].filter(Boolean).join('\n');
    }

    // -----------------------------------------------------------------------
    // After-Action Report
    // -----------------------------------------------------------------------

    private async generateAAR(execution: PipelineExecution): Promise<string> {
        const nodePerf = [...execution.nodeStates.entries()].map(([id, state]) => ({
            node: id,
            status: state.status,
            duration: state.durationMs,
            retries: state.retryCount,
            tokens: state.tokensUsed,
            gateResult: state.qualityGateResult,
        }));

        const totalDuration = Date.now() - new Date(execution.startedAt).getTime();
        const successRate = nodePerf.filter(n => n.status === 'completed').length / nodePerf.length;

        return [
            `# After-Action Report`,
            `Pipeline: ${execution.id}`,
            `Intent: ${execution.intent}`,
            `Status: ${execution.status}`,
            `Duration: ${Math.round(totalDuration / 1000)}s`,
            `Success Rate: ${Math.round(successRate * 100)}%`,
            `Total Tokens: ${execution.totalTokensUsed}`,
            `Total Cost: $${execution.totalCostUsd.toFixed(4)}`,
            ``,
            `## Node Performance`,
            ...nodePerf.map(n =>
                `- **${n.node}**: ${n.status} | ${n.duration}ms | ${n.retries} retries | ${n.tokens} tokens | gate: ${n.gateResult ?? 'n/a'}`
            ),
            ``,
            `## Feedback Loops`,
            ...[...execution.feedbackLoopCounts.entries()].map(([id, count]) =>
                `- ${id}: ${count} iterations`
            ),
        ].join('\n');
    }

    // -----------------------------------------------------------------------
    // Escalation
    // -----------------------------------------------------------------------

    private async escalate(execution: PipelineExecution, reason: string, action: string): Promise<void> {
        const rule = this.orchestrator.escalation_rules.find(r => r.action === action);
        const message = rule?.message_template
            .replace('${node_id}', reason)
            .replace('${pipeline_id}', execution.id)
            .replace('${timeout_minutes}', String(this.graph.execution_config.global_timeout_minutes))
            ?? `[ESCALATION] ${reason}`;

        await eventBus.emit('pipeline.escalation', {
            pipelineId: execution.id,
            reason,
            action,
            message,
            notify: rule?.notify ?? ['marketing_lead'],
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Checkpoint Resolver Interface
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Function that resolves a checkpoint (e.g., human approval via UI/Slack/etc).
 * Returns true if approved, false if rejected.
 * Default implementation auto-approves (for development/testing).
 */
export type CheckpointResolver = (
    checkpoint: Checkpoint,
    execution: PipelineExecution,
) => Promise<boolean>;

const defaultCheckpointResolver: CheckpointResolver = async (checkpoint, execution) => {
    // In production, this would wait for human approval via WebSocket/Slack/API
    // For now, auto-approve with event emission
    await eventBus.emit('checkpoint.auto_approved', {
        pipelineId: execution.id,
        checkpointId: checkpoint.id,
        reason: 'Auto-approved in development mode',
    });
    return true;
};

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

export function getPipelineExecution(pipelineId: string): PipelineExecution | undefined {
    return pipelineExecutions.get(pipelineId);
}

export function listPipelineExecutions(): PipelineExecution[] {
    return [...pipelineExecutions.values()].sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
}

export async function cancelPipeline(pipelineId: string): Promise<boolean> {
    const execution = pipelineExecutions.get(pipelineId);
    if (!execution || execution.status === 'completed' || execution.status === 'failed') return false;

    execution.status = 'cancelled';
    execution.completedAt = new Date().toISOString();

    for (const [, state] of execution.nodeStates) {
        if (state.status === 'pending' || state.status === 'running') {
            state.status = 'skipped';
        }
    }

    persistPipeline(execution);
    await eventBus.emit('pipeline.cancelled', { pipelineId });
    return true;
}
