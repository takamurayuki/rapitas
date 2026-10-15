/**
 * pr-risk-types
 *
 * Shared types and constants for PR merge-failure risk prediction: rollout
 * stages, feature keys, the strict failure definition window and the PR
 * comment marker. Contains no logic.
 */

/** Rollout stages, in migration order (display → hold → auto). */
export const PR_RISK_STAGES = ['off', 'display', 'hold', 'auto'] as const;
export type PrRiskStage = (typeof PR_RISK_STAGES)[number];

/** Model input features. Order is the canonical display/training order. */
export const FEATURE_KEYS = [
  'file_size',
  'files_changed',
  'author',
  'dependency_change',
  'schema_change',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureVector = Record<FeatureKey, number>;

/** Failure = a revert landing within this window after merge (closed interval). */
export const ROLLBACK_WINDOW_MS = 72 * 3600 * 1000;

/** First line of the single, upserted risk comment on a PR. */
export const COMMENT_MARKER = '<!-- rapitas:pr-risk -->';

/** Defaults used when no PrRiskConfig row exists yet. */
export const DEFAULT_STAGE: PrRiskStage = 'off';
export const DEFAULT_THRESHOLD = 0.5;

/** Linear logistic model: logit = baseLogit + Σ w_i (x_i − μ_i). */
export interface PrRiskModel {
  baseLogit: number;
  weights: FeatureVector;
  means: FeatureVector;
}

/** One SHAP value (logit space). */
export interface Contribution {
  feature: FeatureKey;
  phi: number;
}

export interface Prediction {
  score: number;
  baseLogit: number;
  /** Sorted by |phi| descending; [0] is the main factor. */
  contributions: Contribution[];
}

export type OutcomeLabel = 'pending' | 'success' | 'failure';
export type FailureKind = 'rollback_72h' | 'critical_incident';

export interface PrRiskConfigValue {
  stage: PrRiskStage;
  threshold: number;
  modelJson: string | null;
  modelVersion: number;
  stageChangedAt: Date | null;
}

/** A labelled prediction used for metrics and threshold proposals. */
export interface LabelledPrediction {
  score: number;
  thresholdUsed: number;
  label: 'success' | 'failure';
}

/** A labelled training row. */
export interface TrainingRow {
  features: FeatureVector;
  label: 'success' | 'failure';
}

/**
 * Narrow an arbitrary value to a rollout stage.
 *
 * @param value - Candidate value / 判定対象
 * @returns The stage or null when invalid / 段階または null
 */
export function toStage(value: unknown): PrRiskStage | null {
  return typeof value === 'string' && (PR_RISK_STAGES as readonly string[]).includes(value)
    ? (value as PrRiskStage)
    : null;
}
