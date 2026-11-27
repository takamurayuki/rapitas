/**
 * jury-follow-up-record
 *
 * Records, per JuryReviewRun, how many findings an applied diff-review verdict
 * moved to follow-up concerns and why (task 1547 step 7). The record is one
 * WorkflowTransition row that does not move the status, keyed by the run id in
 * its metadata, so no column is added to JuryReviewRun (schema change tracked
 * as concern #15683). Not responsible for deciding what is follow_up
 * (follow-up-findings.ts) or for filing the concerns.
 */
import { createLogger } from '../../config/logger';
import { recordTransition, type TransitionActor } from './transition-recorder';

const log = createLogger('workflow:jury-follow-up-record');

/** Cause of the record row. Readers match causes exactly, so it joins no existing count. */
export const FOLLOW_UP_RECORDED_CAUSE = 'adversarial_review_follow_up';

/** Most reasons kept per record (reasons are LLM-written). */
export const MAX_RECORDED_REASONS = 10;
/** Longest reason kept per record. */
export const MAX_RECORDED_REASON_CHARS = 300;

/** What a record keeps about the deferral. */
export interface FollowUpRecord {
  count: number;
  reasons: string[];
  verdictChanged: boolean;
}

type ReviewLike = {
  verdict?: string;
  followUp?: { count: number; reasons: string[]; verdictChanged: boolean };
} | null;

/**
 * The record for a review, or null when it deferred nothing.
 *
 * @param review - The applied review result / 適用したレビュー結果
 * @returns Bounded record, or null / 上限を掛けた記録（無ければ null）
 */
export function buildFollowUpRecord(review: ReviewLike | undefined): FollowUpRecord | null {
  const f = review?.followUp;
  if (!f || !(f.count >= 1)) return null;
  return {
    count: f.count,
    reasons: (f.reasons ?? [])
      .slice(0, MAX_RECORDED_REASONS)
      .map((r) => String(r).slice(0, MAX_RECORDED_REASON_CHARS)),
    verdictChanged: f.verdictChanged === true,
  };
}

/** Inputs of recordFollowUpDeferral. */
export interface FollowUpDeferralInput {
  taskId: number;
  /** The JuryReviewRun whose verdict was applied. */
  juryRunId: number;
  source: 'http_save' | 'cli_epilogue';
  review: ReviewLike | undefined;
  /** Workflow status after the verdict was applied (the row does not move it). */
  status: string;
  outcome: 'passed' | 'stopped';
  actor?: TransitionActor;
  sessionId?: number | null;
}

/**
 * Write the follow-up record for an APPLIED verdict. Callers must call this
 * only after the verdict took effect (not stale, run still bound). Never
 * throws: a failed write is logged and changes nothing.
 *
 * @param input - Task, run, source, review and the status after applying / 記録の入力
 * @returns The record (also for the completion event), or null when nothing was deferred / 記録（無ければ null）
 */
export async function recordFollowUpDeferral(
  input: FollowUpDeferralInput,
): Promise<FollowUpRecord | null> {
  const followUp = buildFollowUpRecord(input.review);
  if (!followUp) return null;
  try {
    await recordTransition({
      taskId: input.taskId,
      fromStatus: input.status,
      toStatus: input.status,
      actor: input.actor ?? 'system',
      cause: FOLLOW_UP_RECORDED_CAUSE,
      phase: 'verify',
      ...(input.sessionId != null ? { sessionId: input.sessionId } : {}),
      metadata: {
        juryRunId: input.juryRunId,
        source: input.source,
        verdict: input.review?.verdict ?? null,
        outcome: input.outcome,
        followUp,
      },
      invariantViolation: false,
    });
  } catch (err) {
    log.warn({ err, taskId: input.taskId }, '[jury-follow-up] Could not record the deferral');
  }
  return followUp;
}
