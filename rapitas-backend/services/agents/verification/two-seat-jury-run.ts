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
import { assignSeats, type SeatAssignment } from './jury-seats';
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
    reasons: [],
    unknownReason: 'rested',
  });
}

/**
 * Run the two-reviewer jury.
 *
 * A reviewer resting after repeated timeouts is not asked (it would only add
 * its full timeout and answer 'unknown'), but it stays on the record as a
 * rested seat so a one-reviewer review never reads as two. If both rest,
 * both are asked anyway: a blind gate is worse than a slow one.
 *
 * @param prompt - Reviewer prompt (identical for both reviewers) / レビュー席のプロンプト
 * @param inputs - Inputs for the verifier prompt / 検証席のプロンプト入力
 * @returns The composed result and the seat plan / 結果と席の計画
 */
export async function runTwoSeatJury(prompt: string, inputs: VerifierInputs): Promise<TwoSeatRun> {
  const { reviewers, verifier } = assignSeats();
  const now = Date.now();
  const awake = reviewers.filter((s) => !jurorIsRested(s.label, now));
  const toAsk = awake.length > 0 ? awake : reviewers;
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
  };
}
