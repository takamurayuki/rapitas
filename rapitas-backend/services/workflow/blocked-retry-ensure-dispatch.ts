/**
 * blocked-retry-ensure-dispatch
 *
 * Makes one attempt to re-dispatch a just-reset blocked task through its theme's own
 * selector and classifies the outcome. NOT responsible for deciding where the task
 * resumes (see blocked-retry-resume-stage) or for writing its state (blocked-retry-dispatch).
 *
 * Why: the bare draft reset left the task with no execution and no queue item,
 * relying on the theme tick alone to re-pick it. When that did not happen the
 * stagnation detector fired with no trace of why (task 1238, #1235/#1215).
 */
import type { PrismaClient } from '../../generated/prisma-postgres';
import { createLogger } from '../../config/logger';

const log = createLogger('blocked-retry-dispatch');

/** Fixed vocabulary stored in `WorkflowTransition.metadata.dispatch`. */
export type RetryDispatchOutcome =
  | 'kicked'
  | 'slot_busy'
  | 'theme_not_running'
  | 'not_selected'
  | 'not_needed'
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
export interface EnsureDispatchDeps {
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
  deps: EnsureDispatchDeps = {},
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
