/**
 * Stale Execution Recovery
 *
 * Handles detection and cleanup of executions whose owning process died:
 * a one-shot startup pass (server restart) plus a periodic lease sweep that
 * catches deaths the startup pass structurally cannot see — an in-process
 * worker restart leaves rows with createdAt AFTER serverStartedAt, which the
 * timestamp-origin comparison silently skips (the leak the 2026-08
 * architecture review identified). The sweep judges by heartbeat age alone.
 * Not responsible for actually resuming execution — see execution-resume.ts.
 */

import { createLogger } from '../../../config';
import type { OrchestratorContext } from './types';
import {
  reconcileOrphanedBlockedSessions,
  pruneStaleWorktreePointers,
} from './stale-blocked-session-reconciliation';
import { LEASE_STALE_MS } from './execution-heartbeat';

const logger = createLogger('stale-execution-recovery');

const LEASE_SWEEP_INTERVAL_MS = 60_000;
let leaseSweepTimer: NodeJS.Timeout | null = null;

/**
 * Marks stale running/pending executions as interrupted and updates related sessions and tasks.
 * Called once on server startup.
 *
 * @param ctx - Orchestrator context with prisma client and server metadata / オーケストレーターコンテキスト
 * @returns Summary of what was updated / 更新サマリー
 */
export async function recoverStaleExecutions(ctx: OrchestratorContext): Promise<{
  recoveredExecutions: number;
  updatedTasks: number;
  updatedSessions: number;
  interruptedExecutionIds: number[];
  reconciledBlockedSessions: number;
  prunedWorktreePointers: number;
}> {
  logger.info('[RecoveryManager] Starting startup recovery of stale executions...');

  let recoveredExecutions = 0;
  let updatedTasks = 0;
  let updatedSessions = 0;
  let reconciledBlockedSessions = 0;
  let prunedWorktreePointers = 0;
  const interruptedExecutionIds: number[] = [];

  try {
    const activeExecutionIds = Array.from(ctx.activeExecutions.values()).map((e) => e.executionId);

    const staleExecutions = await ctx.prisma.agentExecution.findMany({
      where: {
        status: { in: ['running', 'pending', 'waiting_for_input'] },
        id: { notIn: activeExecutionIds },
        createdAt: { lt: ctx.serverStartedAt },
      },
      include: {
        session: {
          include: {
            config: {
              include: {
                task: {
                  select: { id: true, title: true, status: true },
                },
              },
            },
          },
        },
      },
    });

    if (staleExecutions.length === 0) {
      logger.info('[RecoveryManager] No stale executions found. Recovery complete.');
      // Even with no stale EXECUTIONS, a task can still be left in a blocked/
      // verify-exhausted limbo from before this restart (e.g. its session was
      // never flipped off 'active' because it never had an execution row to
      // begin with) — always run the broader reconciliation pass.
      const blockedResult = await reconcileOrphanedBlockedSessions(ctx);
      return {
        recoveredExecutions: 0,
        updatedTasks: 0,
        updatedSessions: 0,
        interruptedExecutionIds: [],
        reconciledBlockedSessions: blockedResult.reconciledSessionIds.length,
        prunedWorktreePointers: await pruneStaleWorktreePointers(
          ctx,
          new Set(blockedResult.reconciledSessionIds),
        ),
      };
    }

    logger.info(`[RecoveryManager] Found ${staleExecutions.length} stale executions to recover`);

    const affectedSessionIds = new Set<number>();
    const affectedTaskIds = new Set<number>();

    for (const exec of staleExecutions) {
      try {
        await ctx.prisma.agentExecution.update({
          where: { id: exec.id },
          data: {
            status: 'interrupted',
            completedAt: new Date(),
            errorMessage: `サーバー再起動により中断されました。\n\n【最後の出力】\n${(exec.output || '').slice(-1000)}`,
          },
        });
        recoveredExecutions++;
        interruptedExecutionIds.push(exec.id);

        affectedSessionIds.add(exec.sessionId);

        const taskId = exec.session?.config?.task?.id;
        if (taskId) {
          affectedTaskIds.add(taskId);
        }

        logger.info(`[RecoveryManager] Execution ${exec.id} marked as interrupted`);
      } catch (error) {
        logger.error(
          { err: error, executionId: exec.id },
          `[RecoveryManager] Failed to recover execution`,
        );
      }
    }

    // NOTE: updatedSessions must reflect sessions actually marked interrupted,
    // not affectedSessionIds.size — a session with a still-live execution (or
    // a failed update) is intentionally skipped inside updateAffectedSessions,
    // so counting the input set overstated this in the returned summary.
    updatedSessions = await updateAffectedSessions(ctx, affectedSessionIds);

    const tasksUpdated = await updateAffectedTasks(ctx, affectedTaskIds);
    updatedTasks = tasksUpdated;

    // Broaden reconciliation beyond exact task.status === 'in-progress': a task
    // parked 'blocked' by an exhausted verify-repair/replan loop (see
    // workflow-orchestrator.ts / verify-self-repair.ts) can still be left with a
    // dangling AgentSession (status 'active'/'pending' in the DB) if the process
    // died mid-attempt before the session itself was finalized — this session
    // was never touched above because it had no matching stale EXECUTION row
    // (e.g. it never got one, or its only execution already terminated before
    // the crash). Find and finalize those independently of the execution scan.
    const blockedResult = await reconcileOrphanedBlockedSessions(ctx);
    reconciledBlockedSessions = blockedResult.reconciledSessionIds.length;

    // Validate every session touched by EITHER pass still points at a real,
    // reusable worktree — a session can be reconciled (interrupted) while its
    // worktreePath was already removed by a stop/cleanup/merged-PR teardown
    // that happened before this restart. Reusing that phantom path is exactly
    // the "Working directory does not exist" failure mode (see
    // git-operations/worktree-usable.ts); nulling it here makes the NEXT
    // resume/retry recreate a fresh worktree instead of failing.
    const sessionsToValidate = new Set<number>([
      ...affectedSessionIds,
      ...blockedResult.reconciledSessionIds,
    ]);
    prunedWorktreePointers = await pruneStaleWorktreePointers(ctx, sessionsToValidate);

    if (recoveredExecutions > 0) {
      await createRecoveryNotification(ctx, recoveredExecutions, updatedTasks, updatedSessions);
    }

    logger.info(
      `[RecoveryManager] Recovery complete: ${recoveredExecutions} executions, ${updatedTasks} tasks, ${updatedSessions} sessions updated, ` +
        `${reconciledBlockedSessions} orphaned blocked sessions reconciled, ${prunedWorktreePointers} stale worktree pointers pruned`,
    );
  } catch (error) {
    logger.error({ err: error }, '[RecoveryManager] Startup recovery failed');
  }

  return {
    recoveredExecutions,
    updatedTasks,
    updatedSessions,
    interruptedExecutionIds,
    reconciledBlockedSessions,
    prunedWorktreePointers,
  };
}

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
  // orchestrator-instance → agent-orchestrator → this module.
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

/**
 * Marks affected sessions as interrupted when they have no remaining active executions.
 *
 * @param ctx - Orchestrator context / オーケストレーターコンテキスト
 * @param sessionIds - Set of session IDs to check / チェックするセッションIDのセット
 * @returns Number of sessions actually marked interrupted / 実際に中断済みにしたセッション数
 */
async function updateAffectedSessions(
  ctx: OrchestratorContext,
  sessionIds: Set<number>,
): Promise<number> {
  let updated = 0;
  for (const sessionId of sessionIds) {
    try {
      const activeCount = await ctx.prisma.agentExecution.count({
        where: {
          sessionId,
          status: { in: ['running', 'pending', 'waiting_for_input'] },
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
 * Reverts in-progress tasks to 'todo' status.
 *
 * @param ctx - Orchestrator context / オーケストレーターコンテキスト
 * @param taskIds - Set of task IDs to revert / 元に戻すタスクIDのセット
 * @returns Number of tasks that were updated / 更新されたタスクの数
 */
async function updateAffectedTasks(
  ctx: OrchestratorContext,
  taskIds: Set<number>,
): Promise<number> {
  let updated = 0;
  for (const taskId of taskIds) {
    try {
      const task = await ctx.prisma.task.findUnique({
        where: { id: taskId },
        select: { id: true, status: true },
      });

      if (task && task.status === 'in-progress') {
        await ctx.prisma.task.update({
          where: { id: taskId },
          data: { status: 'todo' },
        });
        updated++;
        logger.info(`[RecoveryManager] Task ${taskId} reverted to 'todo'`);
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
async function createRecoveryNotification(
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

/**
 * Returns all executions currently in the 'interrupted' state, newest first.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @returns Array of interrupted execution records / 中断された実行のレコード配列
 */
export async function getInterruptedExecutions(prisma: OrchestratorContext['prisma']): Promise<
  Array<{
    id: number;
    sessionId: number;
    status: string;
    claudeSessionId: string | null;
    output: string;
    createdAt: Date;
  }>
> {
  return (await prisma.agentExecution.findMany({
    where: { status: 'interrupted' },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })) as Array<{
    id: number;
    sessionId: number;
    status: string;
    claudeSessionId: string | null;
    output: string;
    createdAt: Date;
  }>;
}
