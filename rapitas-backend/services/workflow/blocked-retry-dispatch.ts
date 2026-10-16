/**
 * blocked-retry-dispatch
 *
 * Resets a blocked task to draft for its auto-retry AND makes one attempt to
 * re-dispatch it, recording the outcome on the `blocked_auto_retry` transition.
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

const log = createLogger('blocked-retry-dispatch');

/** Fixed vocabulary stored in `WorkflowTransition.metadata.dispatch`. */
export type RetryDispatchOutcome =
  | 'kicked'
  | 'slot_busy'
  | 'theme_not_running'
  | 'not_selected'
  | 'error';

/** Selector signature of auto-run-advance-select's selectAndEnqueueNextTask. */
type SelectFn = (
  prisma: PrismaClient,
  themeId: number,
  order: 'priority' | 'created',
  globalActive: number,
  barrierHoldSince: Map<number, number>,
) => Promise<void>;

/** Test seam: replaces the lazily imported production selector. */
export interface RetryDispatchDeps {
  select?: SelectFn;
}

/**
 * Attempt to dispatch a just-reset task through the theme's own selector.
 *
 * Only a `running` theme with a free slot is kicked; the selector keeps every
 * gate (global concurrency, merge barrier, held tasks) so nothing is enqueued
 * here directly. Never throws.
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param task - Reset task (id and theme). / リセット済みタスク
 * @param deps - Optional selector override for tests. / テスト用差し替え
 * @returns Classified outcome. / 分類結果
 */
export async function ensureRetryDispatch(
  prisma: PrismaClient,
  task: { id: number; themeId: number | null },
  deps: RetryDispatchDeps = {},
): Promise<RetryDispatchOutcome> {
  try {
    if (task.themeId == null) return 'theme_not_running';
    const theme = await prisma.themeAutoRun.findUnique({
      where: { themeId: task.themeId },
      select: { enabled: true, status: true, currentTaskId: true, order: true },
    });
    if (!theme || !theme.enabled || theme.status !== 'running') return 'theme_not_running';
    // The slot is held — by another task (normal wait) or by this task itself,
    // which the scheduler's own current-task branch resumes. Either way a
    // second selection would only add concurrency.
    if (theme.currentTaskId != null) return 'slot_busy';

    const globalActive = await prisma.themeAutoRun.count({
      where: { enabled: true, status: 'running', currentTaskId: { not: null } },
    });
    const select =
      deps.select ?? (await import('./auto-run/auto-run-advance-select')).selectAndEnqueueNextTask;
    await select(
      prisma,
      task.themeId,
      theme.order === 'created' ? 'created' : 'priority',
      globalActive,
      new Map(),
    );

    const after = await prisma.themeAutoRun.findUnique({
      where: { themeId: task.themeId },
      select: { currentTaskId: true },
    });
    return after?.currentTaskId === task.id ? 'kicked' : 'not_selected';
  } catch (err) {
    log.warn({ err, taskId: task.id }, '[blocked-retry] dispatch attempt failed — leaving reset');
    return 'error';
  }
}

/**
 * Reset a blocked task to todo/draft, record `blocked_auto_retry`, then attempt
 * re-dispatch and append the outcome to that transition's metadata.
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param task - Blocked task (id, theme, current workflowStatus). / blockedタスク
 * @param attempt - 1-based retry attempt number. / 試行番号
 * @param deps - Optional selector override for tests. / テスト用差し替え
 * @returns Dispatch outcome. / 再投入結果
 */
export async function resetBlockedTaskForRetry(
  prisma: PrismaClient,
  task: { id: number; themeId: number | null; workflowStatus: string | null },
  attempt: number,
  deps: RetryDispatchDeps = {},
): Promise<RetryDispatchOutcome> {
  await prisma.task
    .update({
      where: { id: task.id },
      data: { status: 'todo', workflowStatus: 'draft', updatedAt: new Date() },
    })
    .catch(() => {});
  await recordTransition({
    taskId: task.id,
    fromStatus: task.workflowStatus,
    toStatus: 'draft',
    actor: 'system',
    cause: 'blocked_auto_retry',
    metadata: { reason: 'blocked_task_auto_retry', attempt },
  }).catch(() => {});

  const dispatch = await ensureRetryDispatch(prisma, task, deps);

  // NOTE: annotate the row recorded above rather than writing a second cause —
  // MAX_BLOCKED_RETRY counts `blocked_auto_retry` rows and detectors read the
  // newest cause, so an extra transition would change both.
  try {
    const row = await prisma.workflowTransition.findFirst({
      where: { taskId: task.id, cause: 'blocked_auto_retry' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (row) {
      await prisma.workflowTransition.update({
        where: { id: row.id },
        data: {
          metadata: JSON.stringify({ reason: 'blocked_task_auto_retry', attempt, dispatch }),
        },
      });
    }
  } catch (err) {
    log.warn({ err, taskId: task.id }, '[blocked-retry] could not annotate dispatch outcome');
  }
  log.info(
    { taskId: task.id, attempt, wf: task.workflowStatus, dispatch },
    '[reconciler] Auto-retried blocked task -> todo (draft)',
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
