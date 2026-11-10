/**
 * two-seat-review
 *
 * The jury form decided by the owner (2026-11-10), as pure functions: two
 * blind reviewers; agreement settles the review; a disagreement sends ONLY the
 * disputed findings to a third, non-voting verifier seat, which says per
 * finding whether its grounds hold, are refuted, or cannot be decided; an
 * undecidable serious dispute is handed to a human (verdict 'hold').
 * Not responsible for asking anyone (adversarial-diff-review.ts) or for the
 * verifier prompt (verifier-seat.ts).
 *
 * Why this replaced the 3-seat majority: ADR 0008 measured that 51% of one
 * model's fails were contested by another model, and a majority vote still
 * bounced the work on a fail nobody had checked. Here a contested fail is
 * checked against its evidence before it can bounce anything.
 */
import type { JurorVerdict, DiffReviewResult } from './adversarial-diff-review-verdict';
import { formatFindingReason, findingSeverityScore, type ReviewFinding } from './review-findings';
import type {
  DisputeBasis,
  FindingVerification,
  SeatId,
  SeatRecord,
  SeatRole,
  SeatTier,
} from './jury-seat-types';

/** A juror verdict tagged with the seat (role) it was asked in. */
export interface SeatedJuror extends JurorVerdict {
  seatId: SeatId;
  role: SeatRole;
  tier: SeatTier;
}

/** The verifier's answer for the disputed finding at 1-based `index`. */
export interface FindingCheck {
  index: number;
  status: FindingVerification;
  note?: string;
}

/** How the two reviewers' results relate. */
export type ReviewerComparison =
  | { kind: 'agreed'; verdict: 'pass' | 'fail'; findings: ReviewFinding[] }
  | {
      kind: 'needs_verification';
      basis: DisputeBasis;
      /** The failing side's gating (evidenced blocker/major) findings. */
      disputed: ReviewFinding[];
      findings: ReviewFinding[];
    }
  | { kind: 'pass_single'; basis: 'single_reviewer' | 'same_model'; findings: ReviewFinding[] }
  | { kind: 'unavailable'; findings: ReviewFinding[] };

const MAX_REASONS = 8;

function tagged(j: SeatedJuror): ReviewFinding[] {
  return (j.findings ?? []).map((f) => ({ ...f, seatId: j.seatId, juror: j.model ?? j.provider }));
}

/**
 * Compare the two reviewer seats.
 *
 * Only two INDEPENDENT judged reviewers can agree. When one seat did not
 * answer, or both seats resolved to the same model, there is a single
 * opinion: a pass stands (recorded as single), a fail is checked by the
 * verifier like a disagreement — one unchecked opinion never bounces work.
 *
 * @param reviewers - The reviewer seats, in seat order / レビュー席の判定
 * @returns How they relate / 2人の関係
 */
export function compareReviewers(reviewers: SeatedJuror[]): ReviewerComparison {
  const findings = reviewers.flatMap(tagged);
  const judged = reviewers.filter((r) => r.verdict === 'pass' || r.verdict === 'fail');
  if (judged.length === 0) return { kind: 'unavailable', findings };

  const failing = judged.filter((r) => r.verdict === 'fail');
  const disputedOf = (rs: SeatedJuror[]) => rs.flatMap(tagged).filter((f) => f.gating);
  const models = new Set(judged.map((r) => r.model ?? r.provider));
  const independent = judged.length === 2 && models.size === 2;

  if (independent) {
    if (failing.length === 0) return { kind: 'agreed', verdict: 'pass', findings };
    if (failing.length === 2) return { kind: 'agreed', verdict: 'fail', findings };
    return { kind: 'needs_verification', basis: 'split', disputed: disputedOf(failing), findings };
  }

  const basis = judged.length === 2 ? 'same_model' : 'single_reviewer';
  if (failing.length === 0) return { kind: 'pass_single', basis, findings };
  return { kind: 'needs_verification', basis, disputed: disputedOf(failing), findings };
}

/** Result of settling the disputed findings with the verifier's checks. */
export interface DisputeSettlement {
  verdict: 'pass' | 'fail' | 'hold';
  upheld: ReviewFinding[];
  refuted: ReviewFinding[];
  undetermined: ReviewFinding[];
  /** Every disputed finding with its verification attached. */
  checked: ReviewFinding[];
}

/**
 * Apply the verifier's per-finding checks to the disputed findings.
 *
 * A finding the verifier did not answer for (or a verifier that did not
 * answer at all: `checks` null) is 'undetermined'. Every disputed finding is a
 * gating blocker/major by construction, so any undetermined one is a serious
 * open dispute and the review goes to a human.
 *
 * @param disputed - Disputed findings, in the order shown to the verifier / 争点
 * @param checks - Verifier answers, or null when it did not answer / 検証結果
 * @returns fail when a grounded finding remains, hold when one is undecidable, else pass / 最終判定
 */
export function settleDispute(
  disputed: ReviewFinding[],
  checks: FindingCheck[] | null,
): DisputeSettlement {
  const byIndex = new Map((checks ?? []).map((c) => [c.index, c]));
  const checked = disputed.map((f, i): ReviewFinding => {
    const c = byIndex.get(i + 1);
    return {
      ...f,
      verification: c?.status ?? 'undetermined',
      ...(c?.note ? { verificationNote: c.note } : {}),
    };
  });
  const upheld = checked.filter((f) => f.verification === 'holds');
  const refuted = checked.filter((f) => f.verification === 'refuted');
  const undetermined = checked.filter((f) => f.verification === 'undetermined');
  const verdict = upheld.length > 0 ? 'fail' : undetermined.length > 0 ? 'hold' : 'pass';
  return { verdict, upheld, refuted, undetermined, checked };
}

function seatRecord(j: SeatedJuror, findingCount?: number): SeatRecord {
  return {
    seatId: j.seatId,
    role: j.role,
    tier: j.tier,
    provider: j.provider,
    ...(j.model ? { model: j.model } : {}),
    verdict: j.verdict,
    severity: j.severity,
    ...(j.unknownReason ? { unknownReason: j.unknownReason } : {}),
    findingCount: findingCount ?? j.findings?.length ?? 0,
  };
}

function failFrom(
  gating: ReviewFinding[],
  severities: number[],
): Pick<DiffReviewResult, 'severity' | 'reasons'> {
  const reasons = [...new Set(gating.map(formatFindingReason))].slice(0, MAX_REASONS);
  const severity = Math.max(
    0,
    ...severities,
    ...gating.map((f) => findingSeverityScore(f.severity)),
  );
  return { severity, reasons };
}

/**
 * Build the review result from the reviewers (and the verifier, when asked).
 * The 'unavailable' comparison is NOT decided here — availability is the
 * caller's risk-gated policy — so it yields verdict 'unknown'.
 *
 * @param p.reviewers - Reviewer seats / レビュー席
 * @param p.comparison - compareReviewers() of them / 比較結果
 * @param p.verification - Verifier seat and its checks, when it was asked / 検証席と結果
 * @returns The review result (two_seat form) / レビュー結果
 */
export function composeTwoSeatResult(p: {
  reviewers: SeatedJuror[];
  comparison: ReviewerComparison;
  verification?: { seat: SeatedJuror; checks: FindingCheck[] | null };
}): DiffReviewResult {
  const { reviewers, comparison } = p;
  const base = {
    form: 'two_seat' as const,
    jurors: [...reviewers, ...(p.verification ? [p.verification.seat] : [])],
    seats: reviewers.map((r) => seatRecord(r)),
  };

  if (comparison.kind === 'unavailable') {
    return { ...base, verdict: 'unknown', severity: 0, reasons: [], judged: false, findings: [] };
  }
  if (
    comparison.kind === 'pass_single' ||
    (comparison.kind === 'agreed' && comparison.verdict === 'pass')
  ) {
    return {
      ...base,
      verdict: 'pass',
      severity: 0,
      reasons: [],
      judged: true,
      findings: comparison.findings,
    };
  }
  if (comparison.kind === 'agreed') {
    const gating = comparison.findings.filter((f) => f.gating);
    return {
      ...base,
      verdict: 'fail',
      ...failFrom(
        gating,
        reviewers.filter((r) => r.verdict === 'fail').map((r) => r.severity),
      ),
      judged: true,
      findings: comparison.findings,
    };
  }

  // needs_verification
  const settlement = settleDispute(comparison.disputed, p.verification?.checks ?? null);
  const checkedByKey = new Map(settlement.checked.map((f) => [`${f.seatId}\u0000${f.summary}`, f]));
  const findings = comparison.findings.map(
    (f) => checkedByKey.get(`${f.seatId}\u0000${f.summary}`) ?? f,
  );
  const seats = p.verification
    ? [...base.seats, seatRecord(p.verification.seat, comparison.disputed.length)]
    : base.seats;
  const dispute = {
    basis: comparison.basis,
    verifierAnswered: p.verification?.checks != null,
    upheld: settlement.upheld.length,
    refuted: settlement.refuted.length,
    undetermined: settlement.undetermined.length,
  };
  const common = { ...base, seats, dispute, judged: true, findings };
  if (settlement.verdict === 'fail') {
    return { ...common, verdict: 'fail', ...failFrom(settlement.upheld, []) };
  }
  if (settlement.verdict === 'hold') {
    return {
      ...common,
      verdict: 'hold',
      severity: Math.max(...settlement.undetermined.map((f) => findingSeverityScore(f.severity))),
      reasons: settlement.undetermined.map(formatFindingReason).slice(0, MAX_REASONS),
      awaitingHuman: {
        reason: 'unresolved_dispute',
        detail: `検証席が根拠の成否を判定できなかった指摘 ${settlement.undetermined.length}件`,
      },
    };
  }
  return { ...common, verdict: 'pass', severity: 0, reasons: [] };
}
