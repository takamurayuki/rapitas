/**
 * Stale Recovery Helpers
 *
 * Shared DB-correction primitives used by both the startup recovery pass
 * (stale-execution-recovery.ts) and the periodic lease sweep
 * (execution-lease-sweep.ts): session finalization, orphaned-session
 * reconciliation, task rollback, and the recovery notification.
 * Not responsible for deciding WHICH executions are stale — callers own
 * detection and pass in the affected id sets.
 */

import { createLogger } from '../../../config';
import type { OrchestratorContext } from './types';
import { recordTransition } from '../../workflow/transition-recorder';

const logger = createLogger('stale-recovery-helpers');

/**
 * Task.executionGenerationId (task 881) was just added to prisma/schema/core.prisma
 * and prisma/schema.desktop/core.prisma but the generated Prisma client is not
 * regenerated until the next server restart (CLAUDE.md forbids running `prisma
 * generate`/`prisma db push` manually — see plan.md §スキーマ変更とデスクトップ版/Web版の同期).
 * Narrow cast on the model only, same shape as verify-self-repair-budget.ts's
 * resolveMaxRepairs pending-column cast — the generated types will include this
 * field again once the client regenerates, at which point this cast becomes a
 * no-op (structurally compatible) and can be removed.
 */
type TaskModelWithGeneration = {
  findUnique: (args: {
    where: { id: number };
    select: { id: true; status: true; workflowStatus: true; executionGenerationId: true };
  }) => Promise<{
    id: number;
    status: string;
    workflowStatus: string | null;
    executionGenerationId: number;
  } | null>;
  updateMany: (args: {
    where: { id: number; executionGenerationId: number };
    data: { status: string };
  }) => Promise<{ count: number }>;
};

/**
 * Execution statuses that mean "this session is still doing something".
 *
 * NOTE: `post_processing` and `canceling` were missing, so a sweep that landed
 * between the CLI exiting and post-processing finishing saw zero live rows and
 * declared a healthy, nearly-finished session `interrupted` (task 893). Both
 * are non-terminal, so neither may count as "no work left".
 */
const LIVE_EXECUTION_STATUSES = [
  'running',
  'pending',
  'waiting_for_input',
  'post_processing',
  'canceling',
] as const;

/**
 * Marks affected sessions as interrupted when they have no remaining active executions.
 *
 * @param ctx - Orchestrator context / オーケストレーターコンテキスト
 * @param sessionIds - Set of session IDs to check / チェックするセッションIDのセット
 * @returns Number of sessions actually marked interrupted / 実際に中断済みにしたセッション数
 */
export async function updateAffectedSessions(
  ctx: OrchestratorContext,
  sessionIds: Set<number>,
): Promise<number> {
  let updated = 0;
  for (const sessionId of sessionIds) {
    try {
      const activeCount = await ctx.prisma.agentExecution.count({
        where: {
          sessionId,
          status: { in: [...LIVE_EXECUTION_STATUSES] },
        },
      });

      if (activeCount === 0) {
        await ctx.prisma.agentSession.update({
          where: { id: sessionId },
          data: {
            status: 'interrupted',
            lastActivityAt: new Date(),
          },
        });
        updated++;
        logger.info(`[RecoveryManager] Session ${sessionId} marked as interrupted`);
      }
    } catch (error) {
      logger.error({ err: error, sessionId }, `[RecoveryManager] Failed to update session`);
    }
  }
  return updated;
}

/**
 * Marks orphaned active/running sessions as interrupted when every one of
 * their executions is already terminal (no LIVE_EXECUTION_STATUSES row left).
 * These sessions are invisible to the execution-keyed startup scan and
 * previously lingered forever as fake "active" state.
 *
 * @param ctx - Orchestrator context / オーケストレーターコンテキスト
 * @returns Number of sessions marked interrupted / 中断済みにしたセッション数
 */
export async function reconcileOrphanedActiveSessions(ctx: OrchestratorContext): Promise<number> {
  let updated = 0;
  try {
    const candidates = await ctx.prisma.agentSession.findMany({
      where: { status: { in: ['active', 'running'] } },
      select: { id: true },
    });
    for (const session of candidates) {
      try {
        const liveCount = await ctx.prisma.agentExecution.count({
          where: {
            sessionId: session.id,
            status: { in: [...LIVE_EXECUTION_STATUSES] },
          },
        });
        if (liveCount === 0) {
          await ctx.prisma.agentSession.update({
            where: { id: session.id },
            data: { status: 'interrupted', lastActivityAt: new Date() },
          });
          updated++;
          logger.info(
            `[RecoveryManager] Orphaned session ${session.id} (no live executions) marked as interrupted`,
          );
        }
      } catch (error) {
        logger.error(
          { err: error, sessionId: session.id },
          '[RecoveryManager] Failed to reconcile orphaned session',
        );
      }
    }
  } catch (error) {
    logger.error({ err: error }, '[RecoveryManager] Orphaned session scan failed');
  }
  return updated;
}

/**
 * Reverts in-progress tasks to 'todo' status.
 *
 * @param ctx - Orchestrator context / オーケストレーターコンテキスト
 * @param taskIds - Set of task IDs to revert / 元に戻すタスクIDのセット
 * @returns Number of tasks that were updated / 更新されたタスクの数
 */
export async function updateAffectedTasks(
  ctx: OrchestratorContext,
  taskIds: Set<number>,
): Promise<number> {
  let updated = 0;
  const taskModel = ctx.prisma.task as unknown as TaskModelWithGeneration;
  for (const taskId of taskIds) {
    try {
      const task = await taskModel.findUnique({
        where: { id: taskId },
        select: { id: true, status: true, workflowStatus: true, executionGenerationId: true },
      });

      if (task && task.status === 'in-progress') {
        // Generation-guarded compare-and-swap (task 881): taskIds was
        // assembled by the CALLER, potentially a while ago (a scan over many
        // stale sessions) — if a user stop-execution incremented
        // executionGenerationId for this task in the meantime, a blind revert
        // here would race the stop's own cleanup (it already reset status to
        // 'todo' and released the lock) and stomp on whatever a newer
        // generation is doing. `stale-recovery-helpers` has no per-session
        // generation column to compare against (out of this task's schema
        // scope), so the WHERE clause itself carries the generation check —
        // this is atomic at the DB level, unlike a separate re-read, so it
        // stays correct no matter how large the gap since `task` was read.
        const result = await taskModel.updateMany({
          where: { id: taskId, executionGenerationId: task.executionGenerationId },
          data: { status: 'todo' },
        });
        if (result.count === 0) {
          logger.info(
            `[RecoveryManager] Task ${taskId} generation changed since scan (was ${task.executionGenerationId}) — skipping revert, a newer stop/recovery already handled it`,
          );
          continue;
        }
        updated++;
        logger.info(`[RecoveryManager] Task ${taskId} reverted to 'todo'`);
        // Record the revert so isWithinRecoveryGrace (incident-signature-detectors.ts)
        // can grant this deliberate `status='todo'` × advanced `workflowStatus`
        // shape its recovery grace period (task 709: previously unrecorded,
        // causing an immediate Pattern B false positive — task #602).
        await recordTransition({
          taskId,
          fromStatus: task.workflowStatus,
          toStatus: task.workflowStatus ?? 'draft',
          actor: 'system',
          cause: 'stale_execution_recovery_revert',
          metadata: { reason: 'stale_execution_recovery' },
        }).catch(() => {});
      }
    } catch (error) {
      logger.error({ err: error, taskId }, `[RecoveryManager] Failed to update task`);
    }
  }
  return updated;
}

/**
 * Creates a notification record informing the user about recovered executions.
 *
 * @param ctx - Orchestrator context / オーケストレーターコンテキスト
 * @param recoveredExecutions - Count of recovered executions / 復旧した実行数
 * @param updatedTasks - Count of updated tasks / 更新されたタスク数
 * @param updatedSessions - Count of updated sessions / 更新されたセッション数
 */
export async function createRecoveryNotification(
  ctx: OrchestratorContext,
  recoveredExecutions: number,
  updatedTasks: number,
  updatedSessions: number,
): Promise<void> {
  try {
    await ctx.prisma.notification.create({
      data: {
        type: 'agent_execution_interrupted',
        title: 'サーバー再起動による中断',
        message: `サーバー再起動により${recoveredExecutions}件のエージェント実行が中断されました。バナーから再開できます。`,
        link: '/',
        metadata: JSON.stringify({
          recoveredExecutions,
          updatedTasks,
          updatedSessions,
        }),
      },
    });
  } catch (error) {
    logger.error({ err: error }, '[RecoveryManager] Failed to create recovery notification');
  }
}
