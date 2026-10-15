/**
 * miss-approval-mode
 *
 * Pure derivation of the miss-signature approval mode (manual vs auto) from
 * counted human review verdicts — no stored mode flag, so the mode can never
 * drift from the evidence. Not responsible for querying the verdicts (see
 * miss-signature-service.ts) nor for applying suggestions.
 */

/** Whether new suggestions require human approval or may auto-apply. */
export type MissApprovalMode = 'manual' | 'auto';

/** Why the mode came out the way it did (surfaced in the UI/summary). */
export type MissApprovalBasis =
  | 'initial_gate' // fewer than initialManualCount human verdicts ever recorded
  | 'insufficient_data' // window sample below floor — no judgement, stay manual
  | 'low_rejection' // window rejection rate at or under the auto threshold
  | 'high_rejection'; // window rejection rate above the threshold — back to manual

export interface MissApprovalConfig {
  /** Human verdicts required before auto mode is even considered (default 10). */
  initialManualCount: number;
  /** Minimum window samples for a rate judgement (default 10). */
  sampleFloor: number;
  /** Max window rejection rate that still allows auto mode (default 0.02). */
  autoThreshold: number;
  /** Trailing window length for the rejection-rate aggregation (default 30d). */
  windowDays: number;
}

/** Counted human verdicts feeding the mode derivation. */
export interface MissReviewStats {
  /** Human verdicts (approve or reject) ever recorded. */
  totalHumanReviews: number;
  /** Human verdicts inside the trailing window. */
  windowSamples: number;
  /** Rejections among windowSamples. */
  windowRejections: number;
}

export interface MissApprovalDecision {
  mode: MissApprovalMode;
  basis: MissApprovalBasis;
  /** Window rejection rate; null when no judgement was made (insufficient data). */
  rejectionRate: number | null;
}

/**
 * Read the approval-mode parameters from RAPITAS_MISS_* env vars, falling back
 * to the plan's defaults. Same convention as the incident watcher's
 * RAPITAS_INCIDENT_* knobs — no UserSettings column, no schema change.
 *
 * @returns The effective configuration. / 有効な設定値
 */
export function readMissApprovalConfig(): MissApprovalConfig {
  const int = (raw: string | undefined, fallback: number): number => {
    const v = parseInt(raw ?? '', 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  const rate = (raw: string | undefined, fallback: number): number => {
    const v = parseFloat(raw ?? '');
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
  };
  return {
    initialManualCount: int(process.env.RAPITAS_MISS_INITIAL_MANUAL_COUNT, 10),
    sampleFloor: int(process.env.RAPITAS_MISS_SAMPLE_FLOOR, 10),
    // 0.02 ≒ "precision ≥ 98%" translated into a rejection-rate bound.
    autoThreshold: rate(process.env.RAPITAS_MISS_AUTO_THRESHOLD, 0.02),
    windowDays: int(process.env.RAPITAS_MISS_WINDOW_DAYS, 30),
  };
}

/**
 * Derive the approval mode from review stats. Branches in priority order:
 * initial gate → data floor → rate comparison. Stateless and bidirectional by
 * construction — sustained rejections push the window rate over the threshold
 * and the next derivation returns manual again, with no flag to unstick.
 *
 * @param stats - Counted human verdicts. / 人間レビューの集計値
 * @param cfg - Threshold configuration. / 閾値設定
 * @returns Mode, basis and the window rejection rate. / モードと根拠
 */
export function resolveApprovalMode(
  stats: MissReviewStats,
  cfg: MissApprovalConfig,
): MissApprovalDecision {
  // Initial trust gate: the first N suggestions ALWAYS need a human, no matter
  // how clean the (tiny) record looks.
  if (stats.totalHumanReviews < cfg.initialManualCount) {
    return { mode: 'manual', basis: 'initial_gate', rejectionRate: null };
  }
  // Data floor: below it we refuse to judge (never guess) — manual, and the
  // rate is withheld entirely so callers cannot act on an unstable number.
  if (stats.windowSamples < cfg.sampleFloor) {
    return { mode: 'manual', basis: 'insufficient_data', rejectionRate: null };
  }
  const rejectionRate = stats.windowRejections / stats.windowSamples;
  if (rejectionRate <= cfg.autoThreshold) {
    return { mode: 'auto', basis: 'low_rejection', rejectionRate };
  }
  return { mode: 'manual', basis: 'high_rejection', rejectionRate };
}
