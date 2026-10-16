/**
 * resume-condition/validity
 *
 * Pure folding of WorkflowTransition rows into the current condition state.
 * Time is an argument so expiry boundaries are testable deterministically.
 */
import {
  RESUME_CONDITION_APPROVED_CAUSE,
  RESUME_CONDITION_REVOKED_CAUSE,
  RESUMABLE_REASONS,
  type ResumeCondition,
  type ResumeEventRow,
  type ResumeTaskContext,
} from './types';

/** Evaluation outcome for the latest approved condition. */
export type ConditionState =
  | { state: 'none' }
  | { state: 'active'; condition: ResumeCondition }
  | { state: 'expired' | 'state_changed' | 'revoked'; condition: ResumeCondition };

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Decode the approved-condition payload from a row; null when malformed.
 *
 * @param row - Approved transition row. / 承認行
 * @param taskId - Owning task. / タスクID
 * @returns The condition or null. / 条件
 */
export function decodeCondition(row: ResumeEventRow, taskId: number): ResumeCondition | null {
  const m = parseJson(row.metadata);
  if (!m || typeof m.questionId !== 'string' || typeof m.expiresAt !== 'number') return null;
  const snap = m.snapshot as ResumeCondition['snapshot'] | undefined;
  const reason = m.reason as ResumeCondition['reason'];
  const spec = m.spec as ResumeCondition['spec'] | undefined;
  if (!snap || !spec || !(RESUMABLE_REASONS as readonly string[]).includes(reason)) return null;
  return {
    questionId: m.questionId,
    taskId,
    reason,
    spec,
    approvedAt: typeof m.approvedAt === 'number' ? m.approvedAt : row.createdAt.getTime(),
    expiresAt: m.expiresAt,
    snapshot: snap,
  };
}

/**
 * Evaluate whether the newest approved condition is still in force.
 *
 * @param rows - All `resume_condition_*` rows of ONE task. / 対象タスクの条件行
 * @param ctx - Live task facts. / 現在のタスク状態
 * @param nowMs - Current time (ms). / 現在時刻
 * @param taskId - Owning task id, stamped on the decoded condition. / タスクID
 * @returns State of the latest approval. / 最新承認の状態
 */
export function evaluateResumeCondition(
  rows: readonly ResumeEventRow[],
  ctx: ResumeTaskContext,
  nowMs: number,
  taskId = 0,
): ConditionState {
  const sorted = [...rows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id,
  );
  let latest: ResumeCondition | null = null;
  for (const r of sorted) {
    if (r.cause !== RESUME_CONDITION_APPROVED_CAUSE) continue;
    latest = decodeCondition(r, taskId) ?? latest;
  }
  if (!latest) return { state: 'none' };
  const questionId = latest.questionId;
  const revoked = sorted.some(
    (r) =>
      r.cause === RESUME_CONDITION_REVOKED_CAUSE &&
      parseJson(r.metadata)?.questionId === questionId,
  );
  if (revoked) return { state: 'revoked', condition: latest };
  // NOTE: >= so a condition is valid for strictly less than 24h; exactly 24h is expired.
  if (nowMs >= latest.expiresAt) return { state: 'expired', condition: latest };
  const s = latest.snapshot;
  if (
    ctx.status !== 'blocked' ||
    ctx.workflowStatus !== s.workflowStatus ||
    ctx.stopMarkerId !== s.stopMarkerId
  ) {
    return { state: 'state_changed', condition: latest };
  }
  return { state: 'active', condition: latest };
}
