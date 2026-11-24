/**
 * review-hold-status
 *
 * The review hold's identifiers and its read side: whether a task is parked
 * for a human review decision, and what the held review found. Split out of
 * review-hold.ts (file-size split); not responsible for writing or clearing
 * the hold.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import type { ReviewFinding } from '../agents/verification/review-findings';
import type { ReviewHoldReason } from '../agents/verification/jury-seat-types';
import { parseHoldMetadata } from './review-hold-records';

// NOTE: Same logger name as review-hold.ts so existing log searches still match.
const log = createLogger('workflow:review-hold');

/** Task.haltReason value of a review hold. */
export const REVIEW_HOLD_HALT_REASON = 'awaiting_review_decision';

/** Transition cause recorded when a task is parked for a human review decision. */
export const REVIEW_HOLD_CAUSE = 'adversarial_review_awaiting_human';

/** Why the task is held and what the review found, as recorded. */
export interface ReviewHoldDetails {
  reason: ReviewHoldReason;
  detail: string;
  findings: ReviewFinding[];
  severity?: number;
  /** Criteria revision when the hold was written (absent on holds older than design 4.5). */
  criteriaRevision?: string;
  /**
   * Workflow status the task is held at: `in_progress` when a pending diff
   * review was held (task 1538), else `verify_done` (absent = verify_done).
   */
  heldStatus?: 'verify_done' | 'in_progress';
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
    // NOTE: in_progress too — a pending diff review is held there so the task
    // never shows verify_done before the review passed (task 1538).
    const heldStatus = task?.workflowStatus;
    if (
      task?.haltReason !== REVIEW_HOLD_HALT_REASON ||
      (heldStatus !== 'verify_done' && heldStatus !== 'in_progress')
    ) {
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
      heldStatus,
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
