/**
 * review-hold-resolve
 *
 * Carries out a human's resolution of a review hold (review-hold.ts):
 *  (a) accept — the findings stand: send the work back to the implementer
 *      through the ordinary bounded repair loop (blocked once exhausted);
 *  (b) override — proceed: record the decision as this exact artifact + diff's
 *      jury-gate completion, then publish (commit / PR / merge) in the
 *      background. The deterministic verification gate still runs inside
 *      commit/PR, so an override waives the review only, not lint/tsc/tests.
 * Not responsible for the HTTP guard (routes/workflow/review-hold.routes.ts).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
import { writeBlockedTask } from './blocked-task-write';
import { readWorkflowFile } from './workflow-file-utils';
import type { OverrideBinding } from './review-hold-publish';
import type { OverridePublisher } from './publish/override-publisher';
import { capFindingsForStorage, formatFindingReason } from '../agents/verification/review-findings';
import {
  clearReviewHold,
  readReviewHold,
  type ReviewHoldAction,
  type ReviewHoldDetails,
} from './review-hold';
import { readCurrentOverrideTarget, type OverrideTarget } from './review-hold-records';

const log = createLogger('workflow:review-hold-resolve');

/** Outcome of a resolution request. */
export type ReviewHoldResolution =
  | {
      ok: true;
      action: ReviewHoldAction;
      /** bounced = sent to repair; blocked = repairs exhausted; publishing = commit/PR started; stale = the task moved meanwhile. */
      outcome: 'bounced' | 'blocked' | 'publishing' | 'stale';
      workflowStatus?: string;
    }
  /**
   * unbound = the override could not be tied to an identifiable artifact + diff;
   * criteria_changed_since = the criteria are no longer those the held review
   * judged (companion design 4.5). The hold stays in both cases.
   */
  | { ok: false; reason: 'not_held' | 'cas_lost' | 'unbound' | 'criteria_changed_since' };

/** Transition cause when an override is refused because it cannot be bound. */
export const REVIEW_OVERRIDE_REFUSED_CAUSE = 'adversarial_review_override_refused';

/** Repair feedback for an accepted hold, in the same shape as a jury FAIL. */
export function acceptedHoldReason(hold: ReviewHoldDetails): string {
  const decisive = hold.findings.filter((f) => f.gating || f.verification === 'undetermined');
  const lines = (decisive.length > 0 ? decisive : hold.findings).map(formatFindingReason);
  return `差分レビュー不合格（人間が指摘を受け入れ）: ${
    lines.slice(0, 5).join(' / ') || hold.detail || '受入基準を満たしていません'
  }`;
}

/**
 * Resolve a review hold.
 *
 * @param p.taskId - Held task / 保留中のタスク
 * @param p.action - accept | override / 解消操作
 * @param p.resolvedBy - Who resolved it (audit label) / 解消した人
 * @param p.note - Optional note / 任意のメモ
 * @param p.publisher - Commit/PR operations an override publishes with (from the route) / 上書き時の commit/PR 処理
 * @returns What happened / 結果
 */
export async function resolveReviewHold(p: {
  taskId: number;
  action: ReviewHoldAction;
  resolvedBy: string;
  note?: string;
  publisher: OverridePublisher;
}): Promise<ReviewHoldResolution> {
  const hold = await readReviewHold(p.taskId);
  if (!hold) return { ok: false, reason: 'not_held' };
  // NOTE: The override's binding is resolved BEFORE the hold is cleared, so an
  // override that cannot name what it covers leaves the task held.
  const bound = p.action === 'override' ? await resolveOverrideBinding(p.taskId) : null;
  if (bound && 'missing' in bound) {
    await recordTransition({
      taskId: p.taskId,
      fromStatus: 'verify_done',
      toStatus: 'verify_done',
      actor: 'user',
      cause: REVIEW_OVERRIDE_REFUSED_CAUSE,
      phase: 'verify',
      metadata: { resolvedBy: p.resolvedBy, holdReason: hold.reason, reason: bound.missing },
    }).catch(() => {});
    log.warn({ taskId: p.taskId, missing: bound.missing }, '[review-hold] Override refused');
    return { ok: false, reason: 'unbound' };
  }
  // An override approves THIS review's findings as not blocking — under the
  // criteria it judged. Criteria changed since (only possible past
  // writeTaskCriteria, which refuses during a hold) = judge again, not wave
  // through. A hold written before revisions existed carries none and binds
  // to the current one.
  if (bound && hold.criteriaRevision && bound.target.criteriaRevision !== hold.criteriaRevision) {
    await recordTransition({
      taskId: p.taskId,
      fromStatus: 'verify_done',
      toStatus: 'verify_done',
      actor: 'user',
      cause: REVIEW_OVERRIDE_REFUSED_CAUSE,
      phase: 'verify',
      metadata: {
        resolvedBy: p.resolvedBy,
        holdReason: hold.reason,
        reason: 'criteria_changed_since',
        heldCriteriaRevision: hold.criteriaRevision,
        currentCriteriaRevision: bound.target.criteriaRevision ?? null,
      },
    }).catch(() => {});
    log.warn(
      { taskId: p.taskId },
      '[review-hold] Override refused — criteria changed since the hold',
    );
    return { ok: false, reason: 'criteria_changed_since' };
  }
  const { publisher, ...resolution } = p;
  if (
    !(await clearReviewHold({ ...resolution, hold, ...(bound ? { target: bound.target } : {}) }))
  ) {
    return { ok: false, reason: 'cas_lost' };
  }

  const verifyContent = (await readWorkflowFile(p.taskId, 'verify').catch(() => null)) ?? '';
  return bound
    ? overrideHold(p.taskId, verifyContent, p.resolvedBy, bound, hold, publisher)
    : acceptHold(p.taskId, hold, verifyContent);
}

/**
 * The verify.md version + diff an override would cover (for publication) and
 * the commit-stable target recorded on the resolution (for the completion
 * paths), or what is missing.
 */
async function resolveOverrideBinding(
  taskId: number,
): Promise<{ binding: OverrideBinding; target: OverrideTarget } | { missing: string }> {
  // NOTE: The target's worktree is the SAME one commit/PR will publish from
  // (latest-active session), not the newest-created one — binding A and
  // publishing B is what this closes.
  const target = await readCurrentOverrideTarget(taskId);
  if ('missing' in target) return target;
  const { currentDiffFingerprint } = await import('../agents/verification/review-diff-fingerprint');
  const diffFingerprint = await currentDiffFingerprint(taskId, target.worktreePath);
  if (!diffFingerprint) return { missing: '差分の識別子（fingerprint）を取得できません' };
  const { verifySha256, worktreePath } = target;
  return { binding: { verifySha256, diffFingerprint, worktreePath }, target };
}

async function acceptHold(
  taskId: number,
  hold: ReviewHoldDetails,
  verifyContent: string,
): Promise<ReviewHoldResolution> {
  const reason = acceptedHoldReason(hold);
  const { attemptVerifyRepair } = await import('./verify-self-repair');
  const repair = await attemptVerifyRepair(taskId, 'verify_done', reason, verifyContent).catch(
    () => ({ bounced: false }) as Awaited<ReturnType<typeof attemptVerifyRepair>>,
  );
  if (repair.stale) return { ok: true, action: 'accept', outcome: 'stale' };

  const { markLatestExecutionFailed } = await import('./publish/mark-latest-execution-failed');
  await markLatestExecutionFailed(taskId, reason).catch(() => {});
  const bounced = repair.bounced && !!repair.newStatus;
  if (!bounced) await writeBlockedTask(prisma, taskId).catch(() => {});
  if (!repair.cutoffRecorded) {
    await recordTransition({
      taskId,
      fromStatus: 'verify_done',
      toStatus: bounced ? repair.newStatus! : 'verify_done',
      actor: 'user',
      cause: 'adversarial_review_failed',
      phase: 'verify',
      metadata: {
        source: 'review_hold_accept',
        holdReason: hold.reason,
        severity: hold.severity,
        reasons: [reason],
        findings: capFindingsForStorage(hold.findings),
      },
      invariantViolation: true,
      invariantMessage: reason,
    }).catch(() => {});
  }
  log.info({ taskId, bounced }, '[review-hold] Hold accepted — findings sent to repair');
  return bounced
    ? { ok: true, action: 'accept', outcome: 'bounced', workflowStatus: repair.newStatus }
    : { ok: true, action: 'accept', outcome: 'blocked', workflowStatus: 'verify_done' };
}

async function overrideHold(
  taskId: number,
  verifyContent: string,
  resolvedBy: string,
  bound: { binding: OverrideBinding; target: OverrideTarget },
  hold: ReviewHoldDetails,
  publisher: OverridePublisher,
): Promise<ReviewHoldResolution> {
  const { binding } = bound;
  // Bind the decision to THIS artifact + diff, like any gate completion: a
  // later verify.md or a changed diff is reviewed again, not waved through.
  // Publication re-checks the same binding before it commits anything.
  const { recordJuryGateCompletion } = await import('./verify-jury-completion');
  await recordJuryGateCompletion({
    taskId,
    verifySha256: binding.verifySha256,
    diffFingerprint: binding.diffFingerprint,
    // readCurrentOverrideTarget refuses (unbound) when it cannot read the revision.
    criteriaRevision: bound.target.criteriaRevision ?? '',
    verdict: 'hold',
    outcome: 'passed',
    source: 'human_override',
  });

  const [{ publishAfterReviewOverride }, { registerVerifyCompletion }] = await Promise.all([
    import('./review-hold-publish'),
    import('./verify-completion-inflight'),
  ]);
  // Commit/PR runs the verification gate, git push and `gh pr create` — minutes,
  // not a request's worth. Registered in-flight so the runner's verify-settle
  // wait sees live work instead of a stuck task.
  const work = publishAfterReviewOverride(
    taskId,
    verifyContent,
    { binding, hold },
    publisher,
  ).catch((err) => log.error({ err, taskId }, '[review-hold] Publication after override failed'));
  registerVerifyCompletion(taskId, work);
  log.info({ taskId, resolvedBy }, '[review-hold] Hold overridden — publishing');
  return { ok: true, action: 'override', outcome: 'publishing', workflowStatus: 'verify_done' };
}
