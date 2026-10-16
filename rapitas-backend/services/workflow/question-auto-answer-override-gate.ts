/**
 * question-auto-answer-override-gate
 *
 * Decides whether a stale question must be left for a human because the task is
 * already sitting on a verification failure only a human can clear. Not
 * responsible for the timeout, eligibility parsing, or the adoption itself —
 * workflow-reconciler-question-auto-answer.ts owns those.
 */
import { createLogger } from '../../config/logger';
import { getLatestJob } from './verification-job-store';

const log = createLogger('workflow-reconciler');

/**
 * Failing checks that no automated answer can clear, because clearing them
 * requires an explicit human act.
 *
 * `schema-change` is human-override-only by construction: a plan declaring the
 * schema file is necessary but never sufficient — `Task.forbiddenChangeOverride`
 * must also be set, and only the human `approve-plan` path sets it (see
 * schema-change-gate.ts). Auto-adopting a recommendation whose stated
 * consequence is "keep the schema change" therefore guarantees the same gate
 * failure on the next verify, which is a bounce loop rather than progress
 * (observed on task 1103, 2026-09-27).
 */
const HUMAN_OVERRIDE_ONLY_CHECKS = new Set(['schema-change']);

/** Why auto-adoption was refused, or null when it may proceed. */
export interface OverrideHoldVerdict {
  hold: boolean;
  /** The failing check that forces a human decision. / 人間判断を要する失敗チェック */
  check?: string;
}

/**
 * Whether the task's most recent verification failed a check that only a human
 * can clear.
 *
 * Fails OPEN: an unreadable verification history leaves the pre-existing
 * behaviour in place. This pass exists precisely so an absent operator does not
 * stall a task indefinitely, so a transient read error must not re-introduce
 * that stall; the failure it guards against (one bounce) is bounded by the
 * iteration budget, while a withheld answer is not bounded by anything.
 *
 * @param taskId - Task whose latest verification job to inspect. / 対象タスクID
 * @returns Whether to hold, and why. / 保留するかとその理由
 */
export async function resolveHumanOverrideHold(taskId: number): Promise<OverrideHoldVerdict> {
  let job;
  try {
    job = await getLatestJob(taskId);
  } catch (err) {
    log.warn(
      { err, taskId },
      '[reconciler] verification history unreadable — allowing auto-answer (fail-open)',
    );
    return { hold: false };
  }
  if (!job || job.status !== 'completed' || !job.checks) return { hold: false };
  const failing = job.checks.find((c) => !c.ok && HUMAN_OVERRIDE_ONLY_CHECKS.has(c.name));
  return failing ? { hold: true, check: failing.name } : { hold: false };
}
