/**
 * auto-run-eligibility
 *
 * Shared "runnable top-level todo" where-fragment for the idle-side counters
 * in auto-run-lifecycle.ts / auto-run-idle-timer.ts. This definition MUST stay
 * in sync with selectNextTask's eligibility (auto-run-selection.ts) —
 * task 635 (2026-08-24 awaiting_question, 2026-08-26 workflowDisabled) showed
 * twice that when the idle-side counters count a task selectNextTask refuses,
 * the theme resumes and is immediately bounced back to idle: a 12s
 * running/idle flap. Task 884 collapsed the 3 idle-side duplicates that
 * carried this risk into this single helper.
 */
import type { Prisma } from '../../../generated/prisma-postgres';

/**
 * Where-fragment for a top-level (parentId:null) 'todo' task that
 * selectNextTask would also consider eligible: not workflow-disabled and not
 * parked on an unanswered question. `extra` is merged in for callers that
 * need an additional narrowing clause (e.g. autoCreatedFromBacklog:false).
 *
 * @param themeId - Theme to scope the count to. / 対象テーマID
 * @param extra - Additional where clauses to merge in. / 追加の絞り込み条件
 * @returns Prisma where input for prisma.task.count/findMany. / count/findMany用のwhere条件
 */
export function eligibleTopLevelTodoWhere(
  themeId: number,
  extra?: Prisma.TaskWhereInput,
): Prisma.TaskWhereInput {
  return {
    themeId,
    status: 'todo',
    parentId: null,
    workflowDisabled: false,
    OR: [{ workflowStatus: null }, { workflowStatus: { not: 'awaiting_question' } }],
    ...extra,
  };
}

/**
 * Where-fragment for a top-level (parentId:null) task in status 'todo' or
 * 'in-progress' that selectNextTask's candidate query (auto-run-selection.ts)
 * would also consider — the SAME clauses, not just the same intent. Used by
 * both `selectNextTask` and the `GET /themes/:id/auto-run` `remainingCount`
 * so the two can never drift apart again (task 889: `remainingCount` was
 * missing the `status:'todo'` OR-branch, undercounting tasks reset to 'todo'
 * for a re-run whose `workflowStatus` was left at a stale terminal value).
 *
 * Deliberately excludes `id: notIn skipTaskIds` — that list is a per-call
 * runtime parameter (currently-running task ids across the whole process),
 * not part of a task's static eligibility, so callers that need it merge it
 * in via `extra`.
 *
 * @param themeId - Theme to scope the query to. / 対象テーマID
 * @param extra - Additional where clauses to merge in (e.g. `id: { notIn }`). / 追加の絞り込み条件
 * @returns Prisma where input for prisma.task.count/findMany. / count/findMany用のwhere条件
 */
export function autoRunCandidateWhere(
  themeId: number,
  extra?: Prisma.TaskWhereInput,
): Prisma.TaskWhereInput {
  return {
    themeId,
    status: { in: ['todo', 'in-progress'] },
    AND: [
      {
        OR: [
          { status: 'todo' },
          { workflowStatus: null },
          { workflowStatus: { notIn: ['completed', 'verify_done'] } },
        ],
      },
      {
        OR: [{ workflowStatus: null }, { workflowStatus: { not: 'awaiting_question' } }],
      },
    ],
    workflowDisabled: false,
    parentId: null,
    ...extra,
  };
}
