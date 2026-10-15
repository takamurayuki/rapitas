/**
 * repair-risk-constants
 *
 * Tunables and vocabulary for the repair-risk predictor (complexity × input
 * length × phase → bounce rate). Holds no logic beyond env-override parsing.
 */

/** Phase vocabulary used by the context builders (same as buildCriticLessonsSection). */
export type RepairRiskStream = 'research' | 'plan' | 'implement' | 'verify';

/** Complexity band derived from Task.complexityScore (0-100). */
export type ComplexityBucket = 'low' | 'mid' | 'high';

/** Input-length band derived from a character count. */
export type InputLengthBucket = 'short' | 'medium' | 'long';

/** Every stream, in pipeline order. */
export const REPAIR_RISK_STREAMS: readonly RepairRiskStream[] = [
  'research',
  'plan',
  'implement',
  'verify',
];

/**
 * stream → role vocabulary (ROLE_TROUBLE_CAUSES / context_section_metrics.role).
 * NOTE: auto_verifier is merged into `verify` — both run the same verifier
 * context, so splitting them would halve an already thin sample.
 */
export const REPAIR_RISK_PHASE_MAP: Record<RepairRiskStream, readonly string[]> = {
  research: ['researcher'],
  plan: ['planner'],
  implement: ['implementer'],
  verify: ['verifier', 'auto_verifier'],
};

/**
 * Roles whose recorded context size stands in for the NEXT stream's input
 * length, most preferred first. A stream's own size is recorded only after its
 * blocks are assembled, so using it to decide its own injection would be
 * circular. Lightweight tasks have no planner run, hence the researcher
 * fallback for `implement`.
 */
export const PRIOR_ROLES: Record<Exclude<RepairRiskStream, 'research'>, readonly string[]> = {
  plan: ['researcher'],
  implement: ['planner', 'researcher'],
  verify: ['implementer'],
};

/** `ActivityLog.action` of a high-risk prediction snapshot. */
export const REPAIR_RISK_PREDICTION_ACTION = 'repair_risk_predicted';

/** Bucket-table cache lifetime; one task runs four phases within minutes. */
export const REPAIR_RISK_CACHE_TTL_MS = 10 * 60 * 1000;

/** Upper bound (inclusive) of the `low` / `mid` complexity bands. */
export const COMPLEXITY_LOW_MAX = 33;
export const COMPLEXITY_MID_MAX = 66;

/** Bounce rate at or above which a stream is "severe" and also gets worked examples. */
export const REPAIR_RISK_SEVERE_RATE = 0.6;

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function envRate(name: string, fallback: number): number {
  const v = parseFloat(process.env[name] ?? '');
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : fallback;
}

/**
 * Minimum samples a cell needs before its rate is trusted (same default as role-evidence).
 *
 * @returns Sample floor. / 最小サンプル数
 */
export function repairRiskMinSamples(): number {
  return envInt('RAPITAS_REPAIR_RISK_MIN_SAMPLES', 8);
}

/**
 * Bounce rate at or above which a cell is high-risk.
 *
 * @returns Threshold in (0, 1]. / 高リスク判定しきい値
 */
export function repairRiskThreshold(): number {
  return envRate('RAPITAS_REPAIR_RISK_THRESHOLD', 0.4);
}

/**
 * Trailing window (days) for the training data. 90 rather than role-evidence's
 * 45: 36 cells dilute samples far more than a per-role split does.
 *
 * @returns Window length in days. / 集計ウィンドウ日数
 */
export function repairRiskWindowDays(): number {
  return envInt('RAPITAS_REPAIR_RISK_WINDOW_DAYS', 90);
}

/**
 * Input-length band bounds. Fixed rather than tertiles: tertiles over a thin
 * history move every week, which would make predictions irreproducible.
 *
 * @returns Inclusive `short` max and inclusive `long` min. / 入力長帯の境界
 */
export function repairRiskInputBounds(): { shortMax: number; longMin: number } {
  return {
    shortMax: envInt('RAPITAS_REPAIR_RISK_INPUT_SHORT_MAX', 2999),
    longMin: envInt('RAPITAS_REPAIR_RISK_INPUT_LONG_MIN', 9000),
  };
}
