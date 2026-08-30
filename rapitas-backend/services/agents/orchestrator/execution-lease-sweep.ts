/**
 * Execution Lease Sweep
 *
 * Periodic dead-lease sweep: interrupts running/pending executions whose
 * heartbeat has gone stale, then dispatches auto-resume for them. Catches
 * process deaths the startup pass structurally cannot see (an in-process
 * worker restart leaves rows whose heartbeat stays AFTER serverStartedAt).
 * Not responsible for the one-shot startup recovery — see
 * stale-execution-recovery.ts.
 */

import { createLogger } from '../../../config';
import { getRecoveryPolicy } from '../../../config/recovery-policy';
import type { OrchestratorContext } from './types';
import { LEASE_STALE_MS } from './execution-heartbeat';
import { updateAffectedSessions, updateAffectedTasks } from './stale-recovery-helpers';

const logger = createLogger('execution-lease-sweep');

const LEASE_SWEEP_INTERVAL_MS = getRecoveryPolicy().leaseSweepIntervalMs;
// Module-level singleton: the sweep must never run twice per process, so the
// timer and both entry points live together in this file (do not re-split).
let leaseSweepTimer: NodeJS.Timeout | null = null;

/**
 * One sweep pass: interrupt running/pending executions whose lease has gone
 * stale. waiting_for_input is deliberately excluded — a question-wait can sit
 * idle for hours with no live agent process, and killing it would destroy the
 * user's chance to answer (the reconciler handles that state separately).
 *
 * @param ctx - Orchestrator context / オーケストレーターコンテキスト
 * @returns Number of executions interrupted / 中断にした実行数
 */
export async function sweepDeadLeaseExecutions(ctx: OrchestratorContext): Promise<number> {
  const staleBefore = new Date(Date.now() - LEASE_STALE_MS);
  const activeExecutionIds = Array.from(ctx.activeExecutions.values()).map((e) => e.executionId);

  const dead = await ctx.prisma.agentExecution.findMany({
    where: {
      status: { in: ['running', 'pending'] },
      // Locally-active rows are alive by definition even if a heartbeat write
      // is momentarily failing — never sweep our own live executions.
      id: { notIn: activeExecutionIds },
      OR: [
        { heartbeatAt: { lt: staleBefore } },
        // Pre-lease rows (written by code before the ownerId/heartbeatAt
        // columns existed) have no heartbeat at all; give them the same
        // stale window measured from creation so they can't linger forever.
        { heartbeatAt: null, createdAt: { lt: staleBefore } },
      ],
    },
    include: {
      session: {
        include: { config: { include: { task: { select: { id: true, status: true } } } } },
      },
    },
  });
  if (dead.length === 0) return 0;

  const affectedSessionIds = new Set<number>();
  const affectedTaskIds = new Set<number>();
  const interruptedIds: number[] = [];
  for (const exec of dead) {
    try {
      await ctx.prisma.agentExecution.update({
        where: { id: exec.id },
        data: {
          status: 'interrupted',
          completedAt: new Date(),
          errorMessage:
            `実行プロセスの停止を検知したため中断されました(lease失効: owner=${exec.ownerId ?? 'unknown'})。` +
            `\n\n【最後の出力】\n${(exec.output || '').slice(-1000)}`,
        },
      });
      interruptedIds.push(exec.id);
      affectedSessionIds.add(exec.sessionId);
      const taskId = exec.session?.config?.task?.id;
      if (taskId) affectedTaskIds.add(taskId);
      logger.warn(
        { executionId: exec.id, ownerId: exec.ownerId, heartbeatAt: exec.heartbeatAt },
        '[LeaseSweep] Interrupted execution with dead lease',
      );
    } catch (error) {
      logger.error({ err: error, executionId: exec.id }, '[LeaseSweep] Failed to interrupt');
    }
  }

  await updateAffectedSessions(ctx, affectedSessionIds);
  await updateAffectedTasks(ctx, affectedTaskIds);

  // Continue the work, don't just bury it: a dead lease usually means a
  // worker/process died mid-phase. Auto-resume (guarded: settings toggle,
  // attempt budget, freshness, supersession check) picks the run back up with
  // --resume session continuity instead of waiting for a human banner click.
  // Dynamic import breaks the static cycle via resume-completion →
  // orchestrator-instance → agent-orchestrator → this module's re-exporter.
  if (interruptedIds.length > 0) {
    void import('./auto-resume')
      .then(({ autoResumeInterruptedExecutions }) =>
        autoResumeInterruptedExecutions(interruptedIds),
      )
      .catch((error) => {
        logger.error({ err: error }, '[LeaseSweep] Auto-resume dispatch failed');
      });
  }
  return dead.length;
}

/**
 * Start the periodic dead-lease sweep (idempotent). Run in the MAIN process
 * only — leases make process topology irrelevant, so one sweeper suffices.
 *
 * @param ctx - Orchestrator context / オーケストレーターコンテキスト
 */
export function startExecutionLeaseSweep(ctx: OrchestratorContext): void {
  if (leaseSweepTimer) return;
  leaseSweepTimer = setInterval(() => {
    sweepDeadLeaseExecutions(ctx).catch((error) => {
      logger.error({ err: error }, '[LeaseSweep] Sweep tick failed');
    });
  }, LEASE_SWEEP_INTERVAL_MS);
  logger.info('[LeaseSweep] Dead-lease execution sweep started');
}
