/**
 * blocked-retry-dispatch
 *
 * Resumes a blocked task for its auto-retry (from the stage it blocked in; draft
 * only when nothing is worth keeping) AND makes one attempt to re-dispatch it, recording the outcome on the `blocked_auto_retry` transition.
 * NOT responsible for retry budgeting or candidate selection (see
 * workflow-reconciler-requeue's requeueBlockedTasks).
 *
 * Why: the bare draft reset left the task with no execution and no queue item,
 * relying on the theme tick alone to re-pick it. When that did not happen the
 * stagnation detector fired with no trace of why (task 1238, #1235/#1215).
 */
import type { PrismaClient } from '../../generated/prisma-postgres';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
import { logCycleEvent } from '../observability/cycle-event-logger';
import { annotateRetryRow, completeMergedTask } from './blocked-retry-writes';
import {
  ensureRetryDispatch,
  type EnsureDispatchDeps,
  type RetryDispatchOutcome,
} from './blocked-retry-ensure-dispatch';
import {
  decideResumeStage,
  isResumableBlockCause,
  loadResumeFacts,
  type ResumeFacts,
  type ResumeReason,
} from './blocked-retry-resume-stage';

const log = createLogger('blocked-retry-dispatch');

/** Last `leave` reason logged per task, so the cycle log is not repeated every tick. */
const leftLogged = new Map<number, string>();

/** Test seam for the resume decision and writes (task 1563) on top of the dispatch seam. */
export interface RetryDispatchDeps extends EnsureDispatchDeps {
  /** Replaces the resume-stage fact lookup. */
  facts?: (task: { id: number; workflowStatus: string | null }) => Promise<ResumeFacts>;
  /** Replaces the stop / cancellation re-check (canReviveBlockedPrRetry). */
  canRevive?: (taskId: number) => Promise<boolean>;
  /** Replaces the merged-PR completion write. */
  complete?: (taskId: number) => Promise<boolean>;
}

export { ensureRetryDispatch };
export type { RetryDispatchOutcome, EnsureDispatchDeps };

/**
 * Auto-retry a blocked task from the stage it blocked in (task 1563).
 *
 * Draft is only the fallback for a task with nothing to lose: an investigation
 * stage, or no worktree and no PR. Work in progress keeps its stage; a
 * `verify_done` task with an open PR returns to the merge watcher's shape; one
 * whose PR is recorded as merged is completed. The `blocked_auto_retry` row
 * records the stage and reason in its metadata, and its cause stays unchanged so
 * MAX_BLOCKED_RETRY keeps counting.
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param task - Blocked task (id, theme, current workflowStatus). / blockedタスク
 * @param attempt - 1-based retry attempt number. / 試行番号
 * @param deps - Optional overrides for tests. / テスト用差し替え
 * @returns Dispatch outcome; `not_needed` when nothing needed dispatching or the task moved on. / 再投入結果
 */
export async function resetBlockedTaskForRetry(
  prisma: PrismaClient,
  task: { id: number; themeId: number | null; workflowStatus: string | null },
  attempt: number,
  deps: RetryDispatchDeps = {},
): Promise<RetryDispatchOutcome> {
  /** 停止・保留は書き込みも試行回数の消費もせず、サイクルログだけに残す。 */
  const leave = (reason: ResumeReason): RetryDispatchOutcome => {
    if (leftLogged.get(task.id) !== reason) {
      leftLogged.set(task.id, reason);
      logCycleEvent('task.blocked', {
        task: task.id,
        from: task.workflowStatus ?? undefined,
        cause: 'blocked_auto_retry_left',
        msg: `blocked auto-retry left the task blocked: ${reason}`,
        attempt,
      });
    }
    log.info({ taskId: task.id, attempt, reason }, '[blocked-retry] leaving the task blocked');
    return 'not_needed';
  };

  // draft 復帰も含め、停止確認 → cause 許可 → 段階決定 → 書き込みの順を守る。
  const canRevive =
    deps.canRevive ?? (await import('./blocked-pr-retry-recovery')).canReviveBlockedPrRetry;
  if (!(await canRevive(task.id))) return leave('left_blocked_stop_guard');
  const facts = await (deps.facts ? deps.facts(task) : loadResumeFacts(prisma, task));
  if (!isResumableBlockCause(facts.blockedCause)) return leave('left_blocked_cause_not_allowed');
  const decision = decideResumeStage(facts);
  if (decision.kind === 'leave') return leave(decision.reason);
  const meta: Record<string, unknown> = {
    reason: 'blocked_task_auto_retry',
    attempt,
    resumeStage: decision.stage ?? 'completed',
    resumeReason: decision.reason,
    stageSource: facts.stageSource ?? 'unknown',
    blockedCause: facts.blockedCause ?? null,
    unpushedCommits: facts.unpushedCommits,
  };
  const record = (toStatus: string) =>
    recordTransition({
      taskId: task.id,
      fromStatus: task.workflowStatus,
      toStatus,
      actor: 'system',
      cause: 'blocked_auto_retry',
      metadata: meta,
    }).catch(() => {});

  // Fresh read: the reconciler's list is stale by now. An operator exclusion or a manual
  // retry since then must win; the writes below repeat both conditions as a CAS.
  // try/catch (not .catch): a partial prisma double without the model throws synchronously.
  let current: { status?: string; autoRunExcluded?: boolean } | null = null;
  try {
    current = await prisma.task.findUnique({
      where: { id: task.id },
      select: { status: true, autoRunExcluded: true },
    });
  } catch {
    // fail open: the CAS below still enforces both conditions on the write itself
  }
  // Only an explicit contrary value stops the retry; a missing field is left to the CAS.
  if (
    current &&
    (current.autoRunExcluded === true || (current.status && current.status !== 'blocked'))
  ) {
    return 'not_needed';
  }
  const casWhere = { id: task.id, status: 'blocked', autoRunExcluded: false };

  let dispatch: RetryDispatchOutcome;
  if (decision.kind === 'complete') {
    if (!(await (deps.complete ?? ((id) => completeMergedTask(prisma, id)))(task.id))) {
      return 'not_needed';
    }
    await record('completed');
    dispatch = 'not_needed';
  } else if (decision.kind === 'merge_wait') {
    const { holdForRequiredMerge } = await import('./required-merge-hold');
    // fromStatus is the row's REAL workflowStatus (null on legacy rows) so the CAS matches;
    // requireNotExcluded makes an operator exclusion after the read above lose the write.
    const held = await holdForRequiredMerge({
      taskId: task.id,
      fromStatus: task.workflowStatus,
      fromStatusIn: ['blocked'],
      requireNotExcluded: true,
      source: 'blocked_auto_retry',
      metadata: { attempt, resumeReason: decision.reason },
    });
    if (!held) {
      log.info(
        { taskId: task.id },
        '[blocked-retry] merge-wait hold lost its CAS — nothing recorded',
      );
      return 'not_needed';
    }
    await record('verify_done');
    dispatch = 'not_needed';
  } else {
    const stamp = new Date();
    // Both branches carry the CAS; `update` (not updateMany) keeps the draft write on the
    // call shape the reconciler's existing contract tests assert, and throws when nothing matches.
    const moved =
      decision.kind === 'keep_stage'
        ? // Persists the stage too: a row restored from history has workflowStatus null.
          await prisma.task
            .updateMany({
              where: casWhere,
              data: { status: 'todo', workflowStatus: decision.stage, updatedAt: stamp },
            })
            .then((r) => r.count > 0)
            .catch(() => false)
        : await prisma.task
            .update({
              where: casWhere,
              data: { status: 'todo', workflowStatus: 'draft', updatedAt: stamp },
            })
            .then(() => true)
            .catch(() => false);
    if (!moved) return 'not_needed';
    await record(decision.stage ?? 'draft');
    dispatch = await ensureRetryDispatch(prisma, task, deps);
  }

  await annotateRetryRow(prisma, task.id, { ...meta, dispatch });
  logCycleEvent('task.revived', {
    task: task.id,
    from: task.workflowStatus ?? undefined,
    to: decision.stage ?? 'completed',
    cause: 'blocked_auto_retry',
    msg: `blocked auto-retry resumed: ${decision.reason}`,
    attempt,
    dispatch,
  });
  log.info(
    { taskId: task.id, attempt, wf: task.workflowStatus, resume: decision, dispatch },
    '[reconciler] Auto-retried blocked task',
  );
  return dispatch;
}

/**
 * Read the dispatch outcome recorded on a task's newest `blocked_auto_retry`.
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param taskId - Task to inspect. / 対象タスク
 * @returns The recorded outcome, or null when absent or unreadable. / 記録された結果
 */
export async function readLastRetryDispatch(
  prisma: PrismaClient,
  taskId: number,
): Promise<RetryDispatchOutcome | null> {
  try {
    const row = await prisma.workflowTransition.findFirst({
      where: { taskId, cause: 'blocked_auto_retry' },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    });
    if (!row?.metadata) return null;
    const dispatch = (JSON.parse(row.metadata) as { dispatch?: unknown }).dispatch;
    return typeof dispatch === 'string' ? (dispatch as RetryDispatchOutcome) : null;
  } catch {
    return null; // fail-open: evidence only, never blocks filing
  }
}
