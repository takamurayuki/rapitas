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

/** Head plus companion ids of a theme row (task 1552). */
function runningIds(head: number | null, companions: Array<{ taskId: number }>): number[] {
  const ids = companions.map((c) => c.taskId);
  return head != null ? [head, ...ids] : ids;
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
    // NOTE: no `select` — companionTasksJson (task 1552) is pending client regeneration.
    const theme = (await prisma.themeAutoRun.findFirst({
      where: { themeId: task.themeId },
    })) as {
      enabled: boolean;
      status: string;
      currentTaskId: number | null;
      order: string;
      companionTasksJson?: unknown;
    } | null;
    if (!theme || !theme.enabled || theme.status !== 'running') return 'theme_not_running';
    const { parseCompanions } = await import('./auto-run/parallel/companion-json');
    const { effectivePerThemeLimit } = await import('./auto-run/parallel/companion-entry');
    const running = runningIds(theme.currentTaskId, parseCompanions(theme.companionTasksJson));
    // This task already holds a slot (the scheduler's own branch resumes it), or
    // every per-theme slot is taken (task 1552: the head alone at limit 1).
    // Either way a second selection would only add concurrency.
    if (running.includes(task.id)) return 'slot_busy';
    if (running.length >= (await effectivePerThemeLimit(prisma))) return 'slot_busy';

    // The same count the scheduler gates on; the legacy count is the fallback.
    const { countGlobalActiveSlots } = await import('./auto-run/parallel/global-active-slots');
    const globalActive = await countGlobalActiveSlots(prisma).catch(() =>
      prisma.themeAutoRun.count({
        where: { enabled: true, status: 'running', currentTaskId: { not: null } },
      }),
    );
    const select =
      deps.select ?? (await import('./auto-run/auto-run-advance-select')).selectAndEnqueueNextTask;
    await select(
      prisma,
      task.themeId,
      theme.order === 'created' ? 'created' : 'priority',
      globalActive,
      new Map(),
    );

    const after = (await prisma.themeAutoRun.findFirst({ where: { themeId: task.themeId } })) as {
      currentTaskId: number | null;
      companionTasksJson?: unknown;
    } | null;
    const afterIds = runningIds(
      after?.currentTaskId ?? null,
      parseCompanions(after?.companionTasksJson),
    );
    return afterIds.includes(task.id) ? 'kicked' : 'not_selected';
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
