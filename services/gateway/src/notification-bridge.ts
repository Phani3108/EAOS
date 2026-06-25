/**
 * Notification Bridge — Wires event bus events to the notification dispatch engine.
 *
 * Listens for execution, agent, vision, and PMO events and auto-dispatches
 * notifications through configured channels and rules.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { eventBus } from './event-bus.js';
import { dispatchByTrigger, type NotificationTrigger } from './notification-dispatch.js';

/**
 * Wire the event bus to the notification dispatch engine.
 * Call this once at server startup, after both systems are initialized.
 */
export function wireNotificationBridge(): void {
  // Execution completed
  eventBus.on('execution.completed', async (event) => {
    await dispatchByTrigger(
      'execution.completed',
      `Execution completed: ${event.data.skillName ?? event.data.executionId ?? 'Unknown'}`,
      `Persona: ${event.data.persona ?? 'N/A'}\nStatus: completed\nQuality: ${event.data.avgQuality ?? 'N/A'}`,
      event.data,
    );
  });

  // Execution failed
  eventBus.on('execution.failed', async (event) => {
    await dispatchByTrigger(
      'execution.failed',
      `Execution FAILED: ${event.data.skillName ?? event.data.executionId ?? 'Unknown'}`,
      `Persona: ${event.data.persona ?? 'N/A'}\nError: ${event.data.error ?? 'Unknown error'}`,
      event.data,
    );
  });

  // Step approval needed — the approval bus emits 'approval.requested' when a step
  // blocks on waitForApproval(); we map it to the 'step.approval_needed' dispatch trigger.
  eventBus.on('approval.requested', async (event) => {
    await dispatchByTrigger(
      'step.approval_needed',
      `Approval needed: ${event.data.stepName ?? 'Step'}`,
      `Agent ${event.data.requesterId ?? 'an agent'} requires your approval to proceed (execution ${event.data.execId ?? ''}).`,
      event.data,
    );
  });

  // Approval SLA breached — still pending after its SLA window.
  eventBus.on('approval.sla_breached', async (event) => {
    await dispatchByTrigger(
      'step.approval_needed',
      `Approval SLA breached: ${event.data.stepName ?? 'Step'}`,
      `An approval for execution ${event.data.execId ?? ''} has been pending beyond its SLA window.`,
      event.data,
    );
  });

  // Agent retraining flagged
  eventBus.on('agent.retraining_flagged', async (event) => {
    await dispatchByTrigger(
      'agent.retraining_flagged',
      `Agent flagged for retraining: ${event.data.agentCallSign ?? event.data.agentId ?? 'Unknown'}`,
      `Reason: ${event.data.reason ?? 'Performance below threshold'}\nSeverity: ${event.data.severity ?? 'warning'}`,
      event.data,
    );
  });

  // Vision decomposed
  eventBus.on('vision.decomposed', async (event) => {
    await dispatchByTrigger(
      'vision.decomposed',
      `Vision decomposed: ${(event.data.statement as string)?.slice(0, 80) ?? 'New vision'}`,
      `CEO (Kronos) decomposed the vision into ${event.data.objectiveCount ?? '?'} strategic objectives.`,
      event.data,
    );
  });

  // PMO escalation
  eventBus.on('pmo.escalation', async (event) => {
    await dispatchByTrigger(
      'pmo.escalation',
      `PMO Escalation: ${event.data.title ?? 'Action required'}`,
      `${event.data.description ?? 'A cross-functional issue requires immediate attention.'}`,
      event.data,
    );
  });

  // KPI threshold breach
  eventBus.on('kpi.threshold_breach', async (event) => {
    await dispatchByTrigger(
      'kpi.threshold_breach',
      `KPI Alert: ${event.data.metric ?? 'Metric'} breached threshold`,
      `Agent: ${event.data.agentCallSign ?? event.data.agentId ?? 'Unknown'}\nCurrent: ${event.data.current ?? '?'} | Threshold: ${event.data.threshold ?? '?'}`,
      event.data,
    );
  });

  console.log('[notification-bridge] Wired 7 event patterns to notification dispatch');
}
