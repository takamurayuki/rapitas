/**
 * resume-condition/suggestion
 *
 * When the same stop reason recurs on a task, offer the previously approved
 * answer so the user can skip re-typing it. A suggestion is never a condition:
 * approval is still required and the value is re-validated.
 */
import {
  RESUME_CONDITION_APPROVED_CAUSE,
  type ResumableReason,
  type ResumeConditionSpec,
  type ResumeEventRow,
} from './types';
import { decodeCondition } from './validity';

/**
 * Find the newest previously approved answer for the same reason.
 *
 * @param rows - `resume_condition_*` rows of ONE task (expired ones included). / 対象タスクの条件行
 * @param reason - Current stop reason. / 現在の停止理由
 * @param excludeQuestionId - Question of the current stop (not a recurrence). / 現在の質問ID
 * @returns The earlier answer's spec, or null. / 過去の回答
 */
export function findSuggestion(
  rows: readonly ResumeEventRow[],
  reason: ResumableReason,
  excludeQuestionId?: string,
): ResumeConditionSpec | null {
  const sorted = [...rows].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id,
  );
  for (const r of sorted) {
    if (r.cause !== RESUME_CONDITION_APPROVED_CAUSE) continue;
    const c = decodeCondition(r, 0);
    if (c && c.reason === reason && c.questionId !== excludeQuestionId) return c.spec;
  }
  return null;
}
