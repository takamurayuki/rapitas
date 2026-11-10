/**
 * jury-seat-types
 *
 * Shared types for the two-reviewer jury form: seats as ROLES (reviewer-1,
 * reviewer-2, verifier) with a capability tier, the per-seat record, and the
 * verifier's per-finding result. Types only — no vendor or model names live
 * here (the tier→model mapping is jury-seats.ts's job).
 */

/** Stable seat identity recorded on every verdict and finding. */
export type SeatId = 'reviewer-1' | 'reviewer-2' | 'verifier';

/** What a seat does: reviewers judge the diff; the verifier only checks grounds. */
export type SeatRole = 'reviewer' | 'verifier';

/** Capability tier a seat requires; resolved to a concrete model per host. */
export type SeatTier = 'premium' | 'standard';

/** The verifier's finding on one disputed finding's grounds. */
export type FindingVerification = 'holds' | 'refuted' | 'undetermined';

/** Why a review is parked for a human decision (review hold). */
export type ReviewHoldReason = 'jury_unavailable_high_risk' | 'unresolved_dispute';

/** How the two reviewers' results were reconciled. */
export type DisputeBasis =
  /** Two independent reviewers disagreed. */
  | 'split'
  /** Only one reviewer answered, so there is no independent second opinion. */
  | 'single_reviewer'
  /** Both seats resolved to the same model — not two independent opinions. */
  | 'same_model';

/** One seat as recorded on the review (timeline / transition metadata). */
export interface SeatRecord {
  seatId: SeatId;
  role: SeatRole;
  tier: SeatTier;
  provider: string;
  model?: string;
  /** Reviewer: pass/fail/unknown. Verifier: pass when it answered, else unknown. */
  verdict: string;
  severity: number;
  unknownReason?: string;
  /** Count of findings this seat reported (reviewers) or checked (verifier). */
  findingCount: number;
}

/** Summary of the verifier step, set only when the verifier seat was asked. */
export interface DisputeSummary {
  basis: DisputeBasis;
  /** False when the verifier did not answer (every dispute is then undetermined). */
  verifierAnswered: boolean;
  upheld: number;
  refuted: number;
  undetermined: number;
}

/** Set when the review needs a human decision instead of pass/fail. */
export interface AwaitingHuman {
  reason: ReviewHoldReason;
  /** One-line human-readable explanation. */
  detail: string;
}
