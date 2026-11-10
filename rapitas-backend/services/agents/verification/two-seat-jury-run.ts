/**
 * two-seat-jury-run
 *
 * Asks the seats of the two-reviewer jury for one review: both reviewers with
 * the same prompt in separate calls (blind — neither sees the other's verdict
 * or findings), and the verifier seat only when the reviewers disagree, with
 * only the disputed findings. Returns the composed result.
 * Not responsible for the prompt inputs (adversarial-diff-review.ts), the
 * decision rules (two-seat-review.ts) or availability policy.
 */
import { createLogger } from '../../../config/logger';
import { assignSeats, type JurySeating, type SeatAssignment } from './jury-seats';
import { resolveExecutorModel } from '../../ai/model-tier-table/executor-model';
import { askJuror, jurorIsRested } from './juror-call';
import { mapJurors } from './juror-scheduling';
import { askVerifier, buildVerifierPrompt } from './verifier-seat';
import { compareReviewers, composeTwoSeatResult, type SeatedJuror } from './two-seat-review';
import type { DiffReviewResult } from './adversarial-diff-review-verdict';

const log = createLogger('verification:adversarial-diff-review');

/** What the run needs besides the reviewer prompt, for the verifier's prompt. */
export interface VerifierInputs {
  taskTitle: string;
  acceptanceCriteria: string[];
  planContent: string;
  diffText: string;
}

/** The composed result plus which seats were planned (verifier only when needed) and actually asked. */
export interface TwoSeatRun {
  result: DiffReviewResult;
  planned: SeatAssignment[];
  asked: SeatAssignment[];
  /** How the seats were assigned this time (mode, independence, shortfalls). */
  seating: SeatingSummary;
}

/** The seat assignment as recorded on the review. */
export interface SeatingSummary {
  mode: JurySeating['plan']['mode'];
  executorModel: string | null;
  seats: Array<{
    seatId: string;
    model: string;
    requiredTier: string;
    independence: string;
  }>;
  shortfalls: JurySeating['plan']['shortfalls'];
  unavailable: JurySeating['unavailable'];
}

function summariseSeating(seating: JurySeating): SeatingSummary {
  return {
    mode: seating.plan.mode,
    executorModel: seating.plan.executor?.modelId ?? null,
    seats: seating.plan.seats.map((s) => ({
      seatId: s.seatId,
      model: s.entry.modelId,
      requiredTier: s.requiredTier,
      independence: s.independence,
    })),
    shortfalls: seating.plan.shortfalls,
    unavailable: seating.unavailable,
  };
}

/**
 * Log and record seats that could not be filled at their requirement, so a
 * review that ran short is visible in the decision trace (追補5: 表示と記録).
 */
function recordSeatShortfalls(taskId: number | undefined, seating: JurySeating): void {
  if (seating.plan.shortfalls.length === 0) return;
  log.warn(
    { taskId, shortfalls: seating.plan.shortfalls, unavailable: seating.unavailable },
    '[adversarial-review] Jury seat requirement unmet — seat left empty, not downgraded',
  );
  if (taskId === undefined) return;
  void import('../../observability/decision-trace')
    .then(({ recordDecision }) =>
      recordDecision({
        taskId,
        nodeKey: `task${taskId}:jury-seats:${Date.now()}`,
        kind: 'param_select',
        summary: '陪審の席の要件未達',
        input: {
          mode: seating.plan.mode,
          executorModel: seating.plan.executor?.modelId ?? null,
          shortfalls: seating.plan.shortfalls,
          unavailable: seating.unavailable,
        },
        candidates: seating.plan.seats.map((s) => ({ id: s.entry.modelId, label: s.seatId })),
        // Not a model choice: what was adopted is "leave these seats empty".
        adoptedId: 'seats_left_unmet',
        adoptedReason: seating.plan.shortfalls.map((s) => `${s.seatId}: ${s.reason}`).join(' / '),
      }),
    )
    .catch(() => {});
}

function seated(
  seat: SeatAssignment,
  v: Omit<SeatedJuror, 'seatId' | 'role' | 'tier' | 'resolvedModel'>,
): SeatedJuror {
  return {
    ...v,
    seatId: seat.seatId,
    role: seat.role,
    tier: seat.tier,
    resolvedModel: seat.resolvedModel,
  };
}

function restedSeat(seat: SeatAssignment): SeatedJuror {
  return seated(seat, {
    provider: seat.provider,
    model: seat.model,
    verdict: 'unknown',
    severity: 0,
    reasons: seat.unmet ? [seat.unmet] : [],
    unknownReason: seat.unmet ? 'seat_unmet' : 'rested',
  });
}

/**
 * Run the two-reviewer jury.
 *
 * Seats are assigned fresh for this review from the vendors usable now and the
 * tier table, held to at least the executor's tier (jury-seats.ts). A seat
 * that cannot be filled is not asked and is recorded as `seat_unmet`; the
 * existing single-reviewer / unavailable rules then decide, so a short jury
 * can never pass as a full one.
 *
 * A reviewer resting after repeated timeouts is not asked (it would only add
 * its full timeout and answer 'unknown'), but it stays on the record as a
 * rested seat so a one-reviewer review never reads as two. If both rest,
 * both are asked anyway: a blind gate is worse than a slow one.
 *
 * @param prompt - Reviewer prompt (identical for both reviewers) / レビュー席のプロンプト
 * @param inputs - Inputs for the verifier prompt / 検証席のプロンプト入力
 * @param opts.taskId - Task under review, to find the executor's model / 対象タスクID
 * @returns The composed result and the seat plan / 結果と席の計画
 */
export async function runTwoSeatJury(
  prompt: string,
  inputs: VerifierInputs,
  opts: { taskId?: number } = {},
): Promise<TwoSeatRun> {
  const executorModel = opts.taskId === undefined ? null : await resolveExecutorModel(opts.taskId);
  const seating = assignSeats({ executorModel });
  recordSeatShortfalls(opts.taskId, seating);
  const { reviewers, verifier } = seating;
  const now = Date.now();
  const fillable = reviewers.filter((s) => !s.unmet);
  const awake = fillable.filter((s) => !jurorIsRested(s.label, now));
  const toAsk = awake.length > 0 ? awake : fillable;
  if (toAsk.length < reviewers.length) {
    log.info(
      { rested: reviewers.filter((s) => !toAsk.includes(s)).map((s) => s.seatId) },
      '[adversarial-review] Reviewer seat resting after repeated timeouts — not asked',
    );
  }
  const answers = await mapJurors(toAsk, async (seat) =>
    seated(seat, await askJuror(seat, prompt)),
  );
  const reviewerVerdicts = reviewers.map(
    (seat) => answers.find((a) => a.seatId === seat.seatId) ?? restedSeat(seat),
  );

  const comparison = compareReviewers(reviewerVerdicts);
  if (comparison.kind !== 'needs_verification') {
    // The verifier is planned only when there is something to verify, so an
    // unasked verifier never reads as a seat that was dropped.
    return {
      result: composeTwoSeatResult({ reviewers: reviewerVerdicts, comparison }),
      planned: [...reviewers],
      asked: toAsk,
      seating: summariseSeating(seating),
    };
  }

  if (verifier.unmet) {
    // No verifier can be seated at its floor: every dispute stays undetermined,
    // which routes the review to a human (two-seat-review.ts) instead of
    // letting a lower-tier model settle it.
    const verifierSeat = restedSeat(verifier);
    return {
      result: composeTwoSeatResult({
        reviewers: reviewerVerdicts,
        comparison,
        verification: { seat: verifierSeat, checks: null },
      }),
      planned: [...reviewers, verifier],
      asked: toAsk,
      seating: summariseSeating(seating),
    };
  }

  const answer = await askVerifier(
    verifier,
    buildVerifierPrompt({ ...inputs, disputed: comparison.disputed }),
    comparison.disputed.length,
  );
  const verifierSeat = seated(verifier, {
    provider: verifier.provider,
    model: verifier.model,
    // The verifier does not vote; 'pass' here only means "it answered".
    verdict: answer.checks ? 'pass' : 'unknown',
    severity: 0,
    reasons: [],
    ...(answer.unknownReason ? { unknownReason: answer.unknownReason } : {}),
    ...(answer.usage ? { usage: answer.usage } : {}),
  });
  return {
    result: composeTwoSeatResult({
      reviewers: reviewerVerdicts,
      comparison,
      verification: { seat: verifierSeat, checks: answer.checks },
    }),
    planned: [...reviewers, verifier],
    asked: [...toAsk, verifier],
    seating: summariseSeating(seating),
  };
}
