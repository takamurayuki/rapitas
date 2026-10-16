/**
 * Stale Blocked-Session Reconciliation
 *
 * Extends startup recovery (see stale-execution-recovery.ts) to two cases it
 * cannot reach because it is keyed off stale AgentExecution rows: sessions
 * left dangling on a `blocked` task with no matching execution row at all, and
 * phantom `worktreePath` pointers (worktree removed by a stop/cleanup/merged-PR
 * teardown) on any reconciled session. Not responsible for the execution-keyed
 * recovery itself — see stale-execution-recovery.ts.
 */
import { createLogger } from '../../../config';
import type { OrchestratorContext } from './types';
import { canReuseWorktree } from './git-operations/worktree/worktree-usable';

const logger = createLogger('stale-execution-recovery');

/**
 * Finalizes AgentSession rows left non-terminal (`active`/`pending`) from
 * before this restart whose task is `blocked` — the "verify-exhausted limbo"
 * case: a verify-repair or replan-exhaustion loop (see verify-self-repair.ts,
 * workflow-orchestrator.ts) set task.status = 'blocked' but the process died
 * before its own session bookkeeping was finalized, so the session never
 * shows up in `recoverStaleExecutions`'s execution-keyed scan (it either never
 * had an execution row, or its only execution had already reached a terminal
 * status before the crash).
 *
 * GUARD: only touches sessions that (a) predate this server start
 * (`lastActivityAt < ctx.serverStartedAt`, so a session created moments ago by
 * this very boot is never touched) and (b) have zero executions currently
 * counted as live by the orchestrator (`ctx.activeExecutions`) — i.e. nothing
 * could still be writing to them. Task.status is left untouched (still
 * 'blocked'): this reconciles bookkeeping, it never silently un-blocks a task.
 *
 * @param ctx - Orchestrator context / オーケストレーターコンテキスト
 * @returns IDs of sessions marked interrupted / 中断済みにしたセッションID一覧
 */
export async function reconcileOrphanedBlockedSessions(
  ctx: OrchestratorContext,
): Promise<{ reconciledSessionIds: number[] }> {
  const reconciledSessionIds: number[] = [];
  try {
    const activeExecutionIds = new Set(
      Array.from(ctx.activeExecutions.values()).map((e) => e.executionId),
    );

    const candidates = await ctx.prisma.agentSession.findMany({
      where: {
        status: { in: ['active', 'pending'] },
        lastActivityAt: { lt: ctx.serverStartedAt },
        config: { task: { status: 'blocked' } },
      },
      select: {
        id: true,
        agentExecutions: {
          where: { status: { in: ['running', 'pending', 'waiting_for_input'] } },
          select: { id: true },
        },
      },
    });

    for (const session of candidates) {
      const hasLiveExecution = session.agentExecutions.some((e) => activeExecutionIds.has(e.id));
      if (hasLiveExecution) continue; // A genuinely live run backs this session — never touch it.

      try {
        await ctx.prisma.agentSession.update({
          where: { id: session.id },
          data: { status: 'interrupted', lastActivityAt: new Date() },
        });
        reconciledSessionIds.push(session.id);
        logger.info(
          `[RecoveryManager] Orphaned blocked-task session ${session.id} reconciled to 'interrupted'`,
        );
      } catch (error) {
        logger.error(
          { err: error, sessionId: session.id },
          '[RecoveryManager] Failed to reconcile orphaned blocked-task session',
        );
      }
    }
  } catch (error) {
    logger.error({ err: error }, '[RecoveryManager] Failed to scan for orphaned blocked sessions');
  }
  return { reconciledSessionIds };
}

/**
 * Nulls `AgentSession.worktreePath` for any session in `sessionIds` whose
 * recorded worktree no longer exists on disk (or isn't a real git worktree —
 * see `canReuseWorktree`). Prevents a later resume/retry from being handed a
 * phantom path and failing "Working directory does not exist" (the recorded
 * cause of the task 30 / task 233 regressions this mirrors the fix for).
 * Never touches `branchName` — a `decideWorktree()` caller can still recreate
 * the worktree on the known branch instead of falling all the way back.
 *
 * @param ctx - Orchestrator context / オーケストレーターコンテキスト
 * @param sessionIds - Sessions to validate / 検証対象セッションID
 * @returns Number of phantom worktree pointers cleared / 削除したポインタ数
 */
export async function pruneStaleWorktreePointers(
  ctx: OrchestratorContext,
  sessionIds: Set<number>,
): Promise<number> {
  if (sessionIds.size === 0) return 0;
  let pruned = 0;
  try {
    const sessions = await ctx.prisma.agentSession.findMany({
      where: { id: { in: Array.from(sessionIds) }, worktreePath: { not: null } },
      select: { id: true, worktreePath: true },
    });

    for (const session of sessions) {
      if (canReuseWorktree(session.worktreePath)) continue; // Still real — leave it for reuse.
      try {
        await ctx.prisma.agentSession.update({
          where: { id: session.id },
          data: { worktreePath: null },
        });
        pruned++;
        logger.info(
          { sessionId: session.id, phantomPath: session.worktreePath },
          '[RecoveryManager] Pruned phantom worktreePath',
        );
      } catch (error) {
        logger.error(
          { err: error, sessionId: session.id },
          '[RecoveryManager] Failed to prune worktreePath',
        );
      }
    }
  } catch (error) {
    logger.error({ err: error }, '[RecoveryManager] Failed to scan sessions for worktree pruning');
  }
  return pruned;
}
