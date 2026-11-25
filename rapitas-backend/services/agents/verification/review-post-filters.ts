/**
 * review-post-filters
 *
 * The deterministic post-processing of a two-seat review result, in order:
 * drop fails about plan items already on the base ref, move out-of-criteria
 * majors to concerns, then move impact=follow_up findings to concerns. Not
 * responsible for the seat vote or the risk policy for an unavailable jury
 * (both stay in adversarial-diff-review.ts and its siblings).
 */
import type { DiffReviewResult } from './adversarial-diff-review-verdict';
import { isDecisiveFinding } from './follow-up-findings';

/** Inputs of the post-filters. */
export interface ReviewPostFilterContext {
  taskId: number;
  themeId: number | null;
  worktreePath: string;
  preferredBaseBranch?: string | null;
  planContent: string;
  changedFiles: string[];
  criteriaCount: number;
  /** Dry runs: no concern is filed. */
  suppressEventLog?: boolean;
}

/**
 * Apply the post-filters to a review result and file the findings they moved
 * out (fire-and-forget; filing never changes the result).
 *
 * @param runResult - Result composed from the seats / 席の判定から組んだ結果
 * @param ctx - Task, diff and criteria context / タスク・差分・受入基準の文脈
 * @returns The adjusted result / 調整後の結果
 */
export async function applyReviewPostFilters(
  runResult: DiffReviewResult,
  ctx: ReviewPostFilterContext,
): Promise<DiffReviewResult> {
  // A fail about a plan item that a sibling PR already put on the base ref can
  // never be fixed by the diff — drop it deterministically (task 1196).
  const { applyBaseSatisfiedFilter } = await import('./base-satisfied-plan-items');
  let result = await applyBaseSatisfiedFilter(runResult, {
    worktreePath: ctx.worktreePath,
    preferredBaseBranch: ctx.preferredBaseBranch,
    planContent: ctx.planContent,
    changedFiles: ctx.changedFiles,
  });
  // Findings no criterion covers become their own tasks instead of bouncing this one.
  const ooc = await import('./out-of-criteria-findings');
  const split = ooc.splitOutOfCriteria(result, ctx.criteriaCount);
  result = split.result;
  // Low-impact findings go to follow-up concerns instead of stopping completion (task 1547).
  const fu = await import('./follow-up-findings');
  const deferred = fu.splitFollowUp(result);
  result = deferred.result;
  if (!ctx.suppressEventLog) {
    const where = { taskId: ctx.taskId, themeId: ctx.themeId };
    void ooc.fileOutOfCriteriaFindings(split.outOfCriteria, where);
    const blocking = (result.findings ?? []).filter(isDecisiveFinding);
    void fu.fileFollowUpFindings(deferred.followUp, where, blocking);
  }
  return result;
}
