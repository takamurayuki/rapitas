/**
 * auto-run-selection
 *
 * Pure helper functions for the theme auto-run scheduler.
 * Selects the next eligible task for a given theme without side effects,
 * making the logic unit-testable without a live DB connection.
 */
import type { Prisma, PrismaClient } from '../../../generated/prisma-postgres';
import { UNMET_DEPENDENCIES_EXCLUDED } from '../../task/task-dependencies';
import { resolveAutoRunMaxConcurrency } from './auto-run-concurrency';
import type { ParallelFilter } from './parallel/parallel-types';
import { hasScopeOverlap } from './auto-run-scope-overlap';
import { priorityRank, valueBandScore } from './auto-run-selection-rank';
import { pickWithParallelFilter } from './auto-run-selection-parallel';

/** Minimum fields from Task used in selection logic. */
export interface SelectableTask {
  id: number;
  status: string;
  workflowStatus: string | null;
  priority: string;
  createdAt: Date;
  complexityScore?: number | null;
}

// Types live in auto-run-selection-types.ts / parallel/parallel-types.ts so this file stays under
// the size limit; re-exported so importers and mock.module mirrors stay unchanged.
export type {
  NoTaskReason,
  SelectionResult,
  ScopeOverlapContext,
} from './auto-run-selection-types';
export type { ParallelRejection, ParallelVerdict, ParallelFilter } from './parallel/parallel-types';
import type { SelectionResult, ScopeOverlapContext } from './auto-run-selection-types';

/**
 * Env-only startup value of the global limit. NOTE: kept for backward
 * compatibility (importers and mock.module mirrors) — the gate itself uses
 * resolveAutoRunMaxConcurrency, which also reads the UserSettings value.
 */
export const AUTO_RUN_GLOBAL_MAX_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.AUTO_RUN_GLOBAL_MAX_CONCURRENCY ?? '1', 10) || 1,
);
export const POLL_INTERVAL_MS = 12_000; // 12 s
export const COOLDOWN_MS = 3_000; // 3 s between task transitions
/**
 * Theme-level hang backstop: if a task stays the "current" task longer than
 * this, the scheduler force-stops it and skips ahead. Guards against a wedged
 * run burning tokens indefinitely (beyond WorkflowRunner's per-phase timeout).
 */
export const MAX_TASK_WALL_MS = Math.max(
  60_000,
  parseInt(process.env.AUTO_RUN_MAX_TASK_WALL_MS ?? '2700000', 10) || 2_700_000, // 45 min
);

// NOTE: moved out for the file-size limit; re-exported so importers and mock.module mirrors of this
// module stay unchanged.
export { priorityRank, valueBandScore, recentThemeSuccessRate } from './auto-run-selection-rank';
export { overlappingFiles, hasScopeOverlap } from './auto-run-scope-overlap';
export { getGlobalAutoRunActiveCount } from './auto-run-global-active-count';

/**
 * Return all active auto-run queue items (queued/running/waiting_approval) for a specific theme.
 *
 * @param prisma - Prisma client instance
 * @param themeId - Theme ID / テーマID
 * @returns array of active queue item records / アクティブなキューアイテムの配列
 */
export async function getThemeActiveQueueItems(
  prisma: PrismaClient,
  themeId: number,
): Promise<Array<{ id: number; taskId: number; status: string }>> {
  return prisma.workflowQueueItem.findMany({
    where: {
      themeId,
      status: { in: ['queued', 'running', 'waiting_approval'] },
    },
    select: { id: true, taskId: true, status: true },
  });
}

/**
 * Determine whether a task should be skipped (was blocked by a previous failure).
 * A task is blocked when its status was explicitly set to 'blocked' by the scheduler.
 *
 * @param taskStatus - Task status string / タスクステータス
 * @returns true if the task should be skipped / スキップすべきならtrue
 */
export function isTaskBlocked(taskStatus: string): boolean {
  return taskStatus === 'blocked';
}

// NOTE: moved to auto-run-liveness.ts (task 1552, file-size limit); re-exported
// here so importers and mock.module mirrors of this module stay unchanged.
export {
  isAwaitingUserAnswer,
  HANG_BACKSTOP_HEARTBEAT_MS,
  resolveLastProgressAt,
  hasLiveExecution,
} from './auto-run-liveness';

/**
 * Select the next task to execute for a given theme.
 *
 * Eligibility criteria:
 *  - status is 'todo' or 'in-progress' (not done/cancelled/archived/blocked/failed)
 *  - workflowStatus is not 'completed' or 'verify_done' (already finished)
 *  - not the currently-running task (avoid re-enqueuing)
 *
 * @param prisma - Prisma client instance
 * @param themeId - Theme whose tasks to search / 検索対象テーマ
 * @param order - 'priority' or 'created' ordering / 優先度順か作成日順
 * @param skipTaskIds - task IDs to skip (e.g. currently running) / スキップするタスクIDセット
 * @param globalActiveCount - current global auto-run active items count / グローバルアクティブ数
 * @param themeSuccessRate - Recent theme success rate for the learnable-band tiebreak (null = legacy ordering). / 直近成功率
 * @param scopeOverlap - Open-PR file context for overlap deferral; omitted = legacy behavior (task 573 B). / スコープ重複コンテキスト
 * @param parallelFilter - Parallel-safety filter; omitted = legacy behavior (task 1552). / 並列安全フィルタ
 * @returns SelectionResult with taskId or reason why none was found / 選択結果
 */
export async function selectNextTask(
  prisma: PrismaClient,
  themeId: number,
  order: 'priority' | 'created',
  skipTaskIds: number[],
  globalActiveCount: number,
  themeSuccessRate: number | null = null,
  scopeOverlap?: ScopeOverlapContext,
  parallelFilter?: ParallelFilter,
): Promise<SelectionResult> {
  const { limit } = await resolveAutoRunMaxConcurrency(prisma);
  if (globalActiveCount >= limit) {
    return { found: false, reason: 'concurrency_limit' };
  }

  // The global off-switch disables phase progression for EVERY task, so the
  // per-task column below cannot catch it. Reported as its own reason rather
  // than as 'all_done': that path refills the backlog, which would file tasks
  // that are equally unable to run and quietly consume the promotion cap.
  //
  // Read through the INJECTED client, not the module-level one — this module is
  // called with a client by design, and reaching past it made the unit tests
  // open a real database connection (98s for one file).
  const globalSwitch = await prisma.userSettings
    .findFirst({ select: { workflowDisabledGlobally: true } })
    .catch(() => null);
  if (globalSwitch?.workflowDisabledGlobally) {
    return { found: false, reason: 'workflow_disabled_globally' };
  }

  const candidates = await prisma.task.findMany({
    where: {
      themeId,
      status: { in: ['todo', 'in-progress'] },
      // A 'todo' task is explicitly pending (incl. one reset to re-run a prior
      // run) — it MUST stay eligible regardless of a stale terminal
      // workflowStatus. The finished-state exclusion applies only to
      // 'in-progress' rows, to avoid re-picking one that is mid-finalization.
      // (A genuinely-done task has status 'done' and is already excluded above.)
      // Without the `status:'todo'` clause, a todo+verify_done task (status reset
      // for re-run, or a verify that didn't complete) was silently skipped and
      // the theme went idle with pending tasks still present.
      AND: [
        {
          OR: [
            { status: 'todo' },
            { workflowStatus: null },
            { workflowStatus: { notIn: ['completed', 'verify_done'] } },
          ],
        },
        {
          // A task parked on a question cannot progress until a human answers,
          // and the orchestrator refuses to dispatch it. Selection must agree
          // with the dispatcher: measured 2026-08-24, task 635 sat at
          // todo + awaiting_question, was selected, refused, cancelled and
          // re-selected — 106 queue items in 21 minutes. The `status:'todo'`
          // clause above deliberately ignores a stale workflowStatus, so
          // awaiting_question has to be excluded explicitly.
          //
          // The null branch is REQUIRED. `NOT { workflowStatus: 'x' }` compiles
          // to `NOT (workflowStatus = 'x')`, which is UNKNOWN — and therefore
          // false — for a NULL column. A freshly filed task has no
          // workflowStatus yet, so the bare NOT excluded every new task: with
          // 10 todo rows in theme 1, selection matched 0 and the theme spun
          // resumed→idle→resumed while its whole backlog sat there.
          OR: [{ workflowStatus: null }, { workflowStatus: { not: 'awaiting_question' } }],
        },
      ],
      // A workflow-disabled task cannot be advanced by the runner, which
      // refuses it with 「ワークフロー無効モードのため自動実行の対象外」. Selection
      // must agree with the dispatcher — exactly the lesson of the
      // awaiting_question clause above, and the same task taught it twice:
      // measured 2026-08-26, task 635 (workflowDisabled, priority high) was
      // selected, refused and released every ~20 seconds for ELEVEN HOURS.
      // Nothing else ran, and because the theme never reached 'all_done' the
      // backlog never refilled either — 121 open concerns sat untouched.
      workflowDisabled: false,
      // User-set opt-out from auto-run selection (Task.autoRunExcluded) — a
      // task card toggle for "keep this out of auto-run, but let it run
      // normally on demand." Independent of workflowDisabled.
      autoRunExcluded: false,
      // A task waiting for a prerequisite that is not done yet (開始条件,
      // #1559). The same fragment is in eligibleTopLevelTodoWhere, so the
      // idle side never resumes a theme for a task selection then refuses.
      ...(UNMET_DEPENDENCIES_EXCLUDED as unknown as Prisma.TaskWhereInput),
      id: skipTaskIds.length > 0 ? { notIn: skipTaskIds } : undefined,
      // Exclude subtasks — the theme scheduler drives top-level tasks only;
      // subtasks are handled by AIOrchestra.enqueueSubtasksForExecution().
      parentId: null,
    },
    // Stable createdAt order from the DB; priority is ranked in JS below.
    orderBy: [{ createdAt: 'asc' }],
    select: {
      id: true,
      status: true,
      workflowStatus: true,
      priority: true,
      createdAt: true,
      complexityScore: true,
    },
    take: 100,
  });

  // Filter out explicitly blocked tasks
  const eligible = candidates.filter((t) => !isTaskBlocked(t.status));

  if (eligible.length === 0) {
    // Blocked tasks are invisible to the candidate query above, so an extra
    // count is the ONLY way to tell "nothing left" from "work exists but every
    // task is wedged" (task 615). Fail-open to all_done on any error so the
    // new query can never break selection.
    let blockedCount = 0;
    try {
      blockedCount = await prisma.task.count({
        where: { themeId, status: 'blocked', parentId: null },
      });
    } catch {
      blockedCount = 0;
    }
    return { found: false, reason: blockedCount > 0 ? 'all_blocked' : 'all_done' };
  }

  // Priority desc, ties by learnable-band value score (R6), then oldest first.
  // Done in JS: the stored priority is a string and can't be SQL-ordered.
  if (order === 'priority') {
    eligible.sort((a, b) => {
      const pr = priorityRank(a.priority) - priorityRank(b.priority);
      if (pr !== 0) return pr;
      const band =
        valueBandScore(b.complexityScore, themeSuccessRate) -
        valueBandScore(a.complexityScore, themeSuccessRate);
      if (band !== 0) return band;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }
  // order === 'created' keeps the DB createdAt-asc order as-is.

  if (parallelFilter) return pickWithParallelFilter(eligible, parallelFilter, scopeOverlap);

  // Scope-overlap deferral (task 573 B): first candidate whose plan files avoid
  // open auto-PR files; no plan = never deferred; all overlap = head, no deferral.
  if (scopeOverlap && scopeOverlap.openPrFiles.length > 0) {
    const deferred: number[] = [];
    for (const candidate of eligible) {
      // In-progress tasks own a worktree with partial work (task 905, 2026-09-13):
      // the deferral keeps NEW work off an open auto-PR's files, never strands them.
      const planFiles =
        candidate.status === 'in-progress'
          ? []
          : await scopeOverlap.getPlanFiles(candidate.id).catch(() => []);
      if (planFiles.length === 0 || !hasScopeOverlap(planFiles, scopeOverlap.openPrFiles)) {
        const hit = { found: true as const, taskId: candidate.id };
        return deferred.length > 0 ? { ...hit, deferred } : hit;
      }
      deferred.push(candidate.id);
    }
    if (scopeOverlap.strict) return { found: false, reason: 'all_overlap_deferred', deferred };
    return { found: true, taskId: eligible[0]!.id };
  }

  return { found: true, taskId: eligible[0]!.id };
}

/**
 * Determine if the currently-enqueued task for a theme is waiting for plan approval.
 * Returns true when the queue item status is 'waiting_approval'.
 *
 * @param queueItems - active queue items for the theme / テーマのアクティブキューアイテム
 * @returns true if ANY item is waiting_approval / waiting_approvalのアイテムがあればtrue
 */
export function hasItemAwaitingApproval(queueItems: Array<{ status: string }>): boolean {
  return queueItems.some((i) => i.status === 'waiting_approval');
}
