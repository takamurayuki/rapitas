/**
 * review-hold
 *
 * The "awaiting a human review decision" hold: a task whose diff review could
 * not be settled (jury unavailable on a high-risk change, or a serious dispute
 * the verifier seat could not decide) is parked at `verify_done` instead of
 * being bounced to the implementer or committed. Owns the hold write, reading
 * it back, and the two resolutions a human may take: (a) accept the findings
 * and send the work to repair, (b) override and let commit/PR proceed.
 * Not responsible for deciding THAT a review needs a human (two-seat-review.ts
 * and adversarial-diff-review.ts) nor for commit/PR itself.
 *
 * Reuses existing machinery instead of a new column (no schema change):
 *  - the iteration-budget halt columns (haltReason / haltedAt /
 *    resumeCondition): every selector, requeue and dispatch guard already
 *    refuses a task whose haltReason is set (auto-run-eligibility,
 *    requeue-unstarted-task, workflow-runner-halt-guard, ...), so a held task
 *    is not picked up again behind the human's back;
 *  - the required-merge-hold shape: a CAS write at verify_done plus a
 *    `verify_done → verify_done` transition carrying the reason, which is what
 *    the timeline and the desktop read.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recordTransition, type TransitionActor } from './transition-recorder';
import { capFindingsForStorage, type ReviewFinding } from '../agents/verification/review-findings';
import type { ReviewHoldReason } from '../agents/verification/jury-seat-types';
import { appendHoldEvent, parseHoldMetadata, type OverrideTarget } from './review-hold-records';

const log = createLogger('workflow:review-hold');

/** Task.haltReason value of a review hold. */
export const REVIEW_HOLD_HALT_REASON = 'awaiting_review_decision';

/** Transition cause recorded when a task is parked for a human review decision. */
export const REVIEW_HOLD_CAUSE = 'adversarial_review_awaiting_human';

/** Transition cause recorded when a human resolves the hold. */
export const REVIEW_HOLD_RESOLVED_CAUSE = 'adversarial_review_hold_resolved';

/** What a human may do with a held review. */
export type ReviewHoldAction = 'accept' | 'override';

/** Task.status values a hold may be written over (a live verify_done task). */
const HOLDABLE_STATUSES = ['in-progress', 'in_progress'];

/** Why the task is held and what the review found, as recorded. */
export interface ReviewHoldDetails {
  reason: ReviewHoldReason;
  detail: string;
  findings: ReviewFinding[];
  severity?: number;
  /** Criteria revision when the hold was written (absent on holds older than design 4.5). */
  criteriaRevision?: string;
}

/**
 * Park a task at `verify_done` for a human review decision. CAS on the status
 * the caller evaluated + a live Task.status, and never over a DIFFERENT halt
 * (an iteration-budget halt keeps its own reason; overriding this hold must
 * not also release that ceiling).
 *
 * The HTTP save path evaluates at `verify_done`; the CLI epilogue's fallback
 * gate runs before the epilogue has moved the task off `in_progress`, so it
 * passes its own status and the hold moves the task to `verify_done`.
 *
 * @param p.taskId - Task to hold / 保留するタスク
 * @param p.fromStatus - Workflow status the caller evaluated (default verify_done) / 呼び出し元が評価した状態
 * @param p.reason - Why a human is needed / 人間が必要な理由
 * @param p.detail - One-line explanation for the human / 説明1行
 * @param p.findings - Findings to show (stored capped by the caller) / 表示する指摘
 * @param p.severity - Highest severity among them / 最大重大度
 * @param p.source - Caller, for the record / 呼び出し元
 * @param p.extra - Extra transition metadata (risk decision etc.) / 追加メタデータ
 * @returns 'held' when parked now or already parked; 'cas_lost' when the task moved on or carries another halt / 結果
 */
export async function holdForHumanReview(p: {
  taskId: number;
  fromStatus?: string;
  reason: ReviewHoldReason;
  detail: string;
  findings: ReviewFinding[];
  severity?: number;
  source: string;
  actor?: TransitionActor;
  sessionId?: number;
  extra?: Record<string, unknown>;
}): Promise<'held' | 'cas_lost'> {
  const fromStatus = p.fromStatus ?? 'verify_done';
  const written = await prisma.task
    .updateMany({
      where: {
        id: p.taskId,
        workflowStatus: fromStatus,
        status: { in: HOLDABLE_STATUSES },
        OR: [{ haltReason: null }, { haltReason: '' }, { haltReason: REVIEW_HOLD_HALT_REASON }],
      },
      data: {
        workflowStatus: 'verify_done',
        haltReason: REVIEW_HOLD_HALT_REASON,
        haltedAt: new Date(),
        resumeCondition: `${p.detail} 解消: 指摘を受け入れて修復へ回す、または上書きして先へ進める。`,
      },
    })
    .catch((err) => {
      log.warn({ err, taskId: p.taskId }, '[review-hold] Hold write failed');
      return { count: 0 };
    });
  if (written.count === 0) {
    log.warn(
      { taskId: p.taskId, source: p.source },
      '[review-hold] Task left verify_done or carries another halt — review hold not written',
    );
    return 'cas_lost';
  }

  // The yardstick the held review was judged against: an override is refused
  // once it differs (review-hold-resolve.ts). Read after the hold write — the
  // gate holds the jury lock here, so no criteria write can land in between.
  const { readCriteriaRevision } = await import('../task/task-criteria-revision');
  const criteriaRevision = await readCriteriaRevision(prisma, p.taskId);
  await recordTransition({
    taskId: p.taskId,
    fromStatus,
    toStatus: 'verify_done',
    actor: p.actor ?? 'system',
    cause: REVIEW_HOLD_CAUSE,
    phase: 'verify',
    sessionId: p.sessionId,
    metadata: {
      source: p.source,
      holdReason: p.reason,
      detail: p.detail,
      findings: p.findings,
      ...(p.severity != null ? { severity: p.severity } : {}),
      ...(p.extra ?? {}),
      ...(criteriaRevision ? { criteriaRevision } : {}),
    },
  }).catch(() => {});
  await appendHoldEvent('review_hold', p.taskId, {
    holdReason: p.reason,
    detail: p.detail,
    findings: p.findings,
    ...(p.severity != null ? { severity: p.severity } : {}),
    source: p.source,
  });
  log.warn(
    { taskId: p.taskId, reason: p.reason, source: p.source },
    '[review-hold] Review could not be settled — task held at verify_done for a human decision',
  );
  return 'held';
}

/** The parts of a 'hold' review result the hold records. */
export interface HeldReview {
  severity: number;
  reasons: string[];
  findings?: ReviewFinding[];
  awaitingHuman?: { reason: ReviewHoldReason; detail: string };
  seats?: unknown;
  dispute?: unknown;
  unavailableRisk?: unknown;
}

/**
 * Write the hold for a review whose verdict is 'hold' — the one call both jury
 * gates (HTTP save, CLI epilogue) make, so they record it identically.
 *
 * @param p.taskId - Task to hold / 保留するタスク
 * @param p.review - The held review result / 保留になったレビュー結果
 * @param p.source - Which gate / どのゲートか
 * @param p.fromStatus - Workflow status the gate evaluated / 評価時の状態
 * @returns Same as holdForHumanReview / 結果
 */
export async function holdFromReview(p: {
  taskId: number;
  review: HeldReview;
  source: 'http_save' | 'cli_epilogue';
  fromStatus?: string;
  actor?: TransitionActor;
  sessionId?: number;
}): Promise<'held' | 'cas_lost'> {
  const { review } = p;
  return holdForHumanReview({
    taskId: p.taskId,
    fromStatus: p.fromStatus,
    reason: review.awaitingHuman?.reason ?? 'jury_unavailable_high_risk',
    detail: review.awaitingHuman?.detail ?? review.reasons[0] ?? '',
    findings: capFindingsForStorage(review.findings),
    severity: review.severity,
    source: p.source,
    actor: p.actor,
    sessionId: p.sessionId,
    extra: {
      ...(review.seats ? { seats: review.seats } : {}),
      ...(review.dispute ? { dispute: review.dispute } : {}),
      ...(review.unavailableRisk ? { risk: review.unavailableRisk } : {}),
    },
  });
}

/** A review-hold read: held, confirmed not held, or not known (read failed). */
export type ReviewHoldProbe =
  | { state: 'held'; hold: ReviewHoldDetails }
  | { state: 'clear' }
  | { state: 'unknown' };

/**
 * Read the current hold, keeping "not held" apart from "could not read" —
 * completion paths must refuse on `unknown`. Never throws.
 * @param taskId - Task id / タスクID
 * @returns The hold, `clear`, or `unknown` on a read failure / 保留・保留なし・確認不能
 */
export async function probeReviewHold(taskId: number): Promise<ReviewHoldProbe> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { haltReason: true, workflowStatus: true },
    });
    if (task?.haltReason !== REVIEW_HOLD_HALT_REASON || task.workflowStatus !== 'verify_done') {
      return { state: 'clear' };
    }
    const row = await prisma.workflowTransition.findFirst({
      where: { taskId, cause: REVIEW_HOLD_CAUSE },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    });
    const m = parseHoldMetadata(row?.metadata);
    const hold: ReviewHoldDetails = {
      reason:
        m.holdReason === 'unresolved_dispute' || m.holdReason === 'ineligible_verifier'
          ? m.holdReason
          : 'jury_unavailable_high_risk',
      detail: typeof m.detail === 'string' ? m.detail : '',
      findings: Array.isArray(m.findings) ? (m.findings as ReviewFinding[]) : [],
      ...(typeof m.severity === 'number' ? { severity: m.severity } : {}),
      ...(typeof m.criteriaRevision === 'string' && m.criteriaRevision
        ? { criteriaRevision: m.criteriaRevision }
        : {}),
    };
    return { state: 'held', hold };
  } catch (err) {
    log.warn({ err, taskId }, '[review-hold] Hold read failed');
    return { state: 'unknown' };
  }
}

/**
 * The current hold, or null when not held OR unreadable (display / resolve callers).
 * @param taskId - Task id / タスクID
 * @returns Hold details from the latest hold transition / 保留の内容
 */
export async function readReviewHold(taskId: number): Promise<ReviewHoldDetails | null> {
  const p = await probeReviewHold(taskId);
  return p.state === 'held' ? p.hold : null;
}

/**
 * Clear the review hold (CAS on the hold itself) and record who resolved it
 * and how. Only the review hold is cleared — a different halt is untouched.
 *
 * @param p.taskId - Held task / 保留中のタスク
 * @param p.action - accept | override / 解消操作
 * @param p.resolvedBy - Who resolved it (audit) / 解消した人
 * @param p.note - Optional note / 任意のメモ
 * @param p.hold - The hold being resolved / 解消する保留
 * @param p.target - What an override covers; completion paths honour the override only while it still matches / 上書きの対象
 * @returns True when this call cleared the hold / この呼び出しで解除したら true
 */
export async function clearReviewHold(p: {
  taskId: number;
  action: ReviewHoldAction;
  resolvedBy: string;
  note?: string;
  hold: ReviewHoldDetails;
  target?: OverrideTarget;
}): Promise<boolean> {
  const cleared = await prisma.task
    .updateMany({
      where: { id: p.taskId, workflowStatus: 'verify_done', haltReason: REVIEW_HOLD_HALT_REASON },
      data: { haltReason: null, haltedAt: null, resumeCondition: null },
    })
    .catch((err) => {
      log.warn({ err, taskId: p.taskId }, '[review-hold] Clear write failed');
      return { count: 0 };
    });
  if (cleared.count === 0) return false;
  await recordTransition({
    taskId: p.taskId,
    fromStatus: 'verify_done',
    toStatus: 'verify_done',
    actor: 'user',
    cause: REVIEW_HOLD_RESOLVED_CAUSE,
    phase: 'verify',
    metadata: {
      action: p.action,
      resolvedBy: p.resolvedBy,
      holdReason: p.hold.reason,
      ...(p.note ? { note: p.note } : {}),
      ...(p.target ? { binding: p.target } : {}),
    },
  }).catch(() => {});
  await appendHoldEvent('review_hold_resolved', p.taskId, {
    action: p.action,
    resolvedBy: p.resolvedBy,
    holdReason: p.hold.reason,
    ...(p.note ? { note: p.note } : {}),
  });
  return true;
}
