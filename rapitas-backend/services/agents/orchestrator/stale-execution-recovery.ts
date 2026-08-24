/**
 * Stale Execution Recovery
 *
 * One-shot startup pass that corrects executions whose owning process died
 * across a server restart: judges death by heartbeatAt < serverStartedAt
 * (createdAt fallback for pre-lease rows) and splits corrections — superseded
 * rows become cancelled, resumable ones interrupted. Also the stable public
 * window for the recovery module family: the periodic lease sweep
 * (execution-lease-sweep.ts) is re-exported here so consumers and test mocks
 * keep a single module path. Shared DB-correction primitives live in
 * stale-recovery-helpers.ts. Not responsible for actually resuming execution
 * — see execution-resume.ts.
 */

import { createLogger } from '../../../config';
import type { OrchestratorContext } from './types';
import {
  reconcileOrphanedBlockedSessions,
  pruneStaleWorktreePointers,
} from './stale-blocked-session-reconciliation';
import {
  updateAffectedSessions,
  reconcileOrphanedActiveSessions,
  updateAffectedTasks,
  createRecoveryNotification,
} from './stale-recovery-helpers';

// NOTE: Re-exported (not moved) on purpose — recovery-manager.ts and the
// mock.module calls in recovery-manager.test.ts resolve these via THIS module
// path; dropping the re-export would make those mocks miss and load the real
// implementation.
export { sweepDeadLeaseExecutions, startExecutionLeaseSweep } from './execution-lease-sweep';

const logger = createLogger('stale-execution-recovery');

/**
 * Corrects stale running/pending/waiting_for_input executions on startup:
 * rows with a newer successor execution become cancelled (terminal duplicate),
 * the rest become interrupted (auto-resume candidates). Related sessions and
 * tasks are rolled back accordingly. Called once on server startup.
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
        // Judge death by heartbeat, not row age: a dead previous process can
        // never beat after serverStartedAt, while a row STARTED after this
        // boot always has a fresh heartbeat (startExecutionHeartbeat beats
        // immediately) and must stay untouched. Pre-lease rows (heartbeatAt
        // null, written before the column existed) fall back to createdAt —
        // same shape as the lease sweep (execution-lease-sweep.ts).
        OR: [
          { heartbeatAt: { lt: ctx.serverStartedAt } },
          { heartbeatAt: null, createdAt: { lt: ctx.serverStartedAt } },
        ],
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
      // begin with) — always run the broader reconciliation pass. Orphaned
      // active sessions (all executions already terminal — the task-570 fake
      // spinner) by definition have no stale execution row either, so this
      // path must reconcile them too.
      const orphanedSessions = await reconcileOrphanedActiveSessions(ctx);
      const blockedResult = await reconcileOrphanedBlockedSessions(ctx);
      return {
        recoveredExecutions: 0,
        updatedTasks: 0,
        updatedSessions: orphanedSessions,
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
        const taskId = exec.session?.config?.task?.id;

        // Cancelled vs interrupted: a newer execution for the same task means
        // the task already moved on — resuming this row would duplicate work.
        // The status set matches auto-resume's supersession check exactly so
        // the two never disagree about what counts as a successor. If taskId
        // is unresolvable the successor is unknowable — fail safe to
        // interrupted (resumable).
        let hasSuccessor = false;
        if (taskId) {
          const successor = await ctx.prisma.agentExecution.findFirst({
            where: {
              id: { gt: exec.id },
              status: { in: ['running', 'pending', 'waiting_for_input', 'completed'] },
              session: { config: { taskId } },
            },
            select: { id: true },
          });
          hasSuccessor = !!successor;
        }

        await ctx.prisma.agentExecution.update({
          where: { id: exec.id },
          data: {
            status: hasSuccessor ? 'cancelled' : 'interrupted',
            completedAt: new Date(),
            errorMessage: hasSuccessor
              ? `後継実行が存在するため、サーバー再起動時に取消されました。\n\n【最後の出力】\n${(exec.output || '').slice(-1000)}`
              : `サーバー再起動により中断されました。\n\n【最後の出力】\n${(exec.output || '').slice(-1000)}`,
          },
        });
        recoveredExecutions++;
        // Cancelled rows are terminal duplicates — they must NOT enter the
        // auto-resume pipeline that consumes this list.
        if (!hasSuccessor) {
          interruptedExecutionIds.push(exec.id);
        }

        affectedSessionIds.add(exec.sessionId);

        if (taskId) {
          affectedTaskIds.add(taskId);
        }

        logger.info(
          `[RecoveryManager] Execution ${exec.id} marked as ${hasSuccessor ? 'cancelled (successor exists)' : 'interrupted'}`,
        );
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

    // Orphaned active/running sessions whose executions are ALL terminal never
    // appear in the execution-keyed scan above (they have no stale execution
    // row) — the task-570 fake-spinner shape. Finalize them independently.
    updatedSessions += await reconcileOrphanedActiveSessions(ctx);

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
