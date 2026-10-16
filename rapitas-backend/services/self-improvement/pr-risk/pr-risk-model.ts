/**
 * pr-risk-model
 *
 * Linear logistic PR-risk model with exact closed-form SHAP values and a
 * deterministic trainer. For a linear model in logit space the SHAP value of
 * feature i is exactly φ_i = w_i (x_i − μ_i), so the explanation is additive
 * (baseLogit + Σφ = logit(score)) without any external ML library.
 * Pure — no I/O.
 */
import {
  FEATURE_KEYS,
  type FeatureVector,
  type PrRiskModel,
  type Prediction,
  type TrainingRow,
} from './pr-risk-types';

/**
 * Hand-set prior used until enough labels exist to train (§特徴量と SHAP).
 * baseLogit −2.2 ≈ a 10% base failure rate.
 */
export const PRIOR_MODEL: PrRiskModel = {
  baseLogit: -2.2,
  weights: {
    file_size: 0.6,
    files_changed: 0.4,
    author: 0.3,
    dependency_change: 0.8,
    schema_change: 0.7,
  },
  means: {
    file_size: 5.0,
    files_changed: 2.0,
    author: 0.0,
    dependency_change: 0.1,
    schema_change: 0.05,
  },
};

const L2_LAMBDA = 0.01;
const LEARNING_RATE = 0.1;
const ITERATIONS = 500;

/** Logistic function. */
export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** Inverse of sigmoid. */
export function logit(p: number): number {
  return Math.log(p / (1 - p));
}

function isVector(v: unknown): v is FeatureVector {
  if (!v || typeof v !== 'object') return false;
  const rec = v as Record<string, unknown>;
  return FEATURE_KEYS.every((k) => typeof rec[k] === 'number' && Number.isFinite(rec[k]));
}

/**
 * Parse a stored model, falling back to the prior on null / malformed JSON.
 *
 * @param json - PrRiskConfig.modelJson / 保存済みモデルJSON
 * @returns A usable model / 利用可能なモデル
 */
export function parseModel(json: string | null): PrRiskModel {
  if (!json) return PRIOR_MODEL;
  try {
    const raw = JSON.parse(json) as Partial<PrRiskModel>;
    if (typeof raw.baseLogit === 'number' && isVector(raw.weights) && isVector(raw.means)) {
      return { baseLogit: raw.baseLogit, weights: raw.weights, means: raw.means };
    }
  } catch {
    /* fall through to the prior */
  }
  return PRIOR_MODEL;
}

/**
 * Score a PR and explain it with exact SHAP values.
 *
 * @param model - Linear model / 線形モデル
 * @param x - Feature vector / 特徴量
 * @returns Score, base logit and contributions sorted by |φ| desc / スコアと寄与
 */
export function predict(model: PrRiskModel, x: FeatureVector): Prediction {
  const contributions = FEATURE_KEYS.map((feature) => ({
    feature,
    phi: model.weights[feature] * (x[feature] - model.means[feature]),
  }));
  const z = model.baseLogit + contributions.reduce((s, c) => s + c.phi, 0);
  // Stable sort keeps FEATURE_KEYS order among equal magnitudes.
  contributions.sort((a, b) => Math.abs(b.phi) - Math.abs(a.phi));
  return { score: sigmoid(z), baseLogit: model.baseLogit, contributions };
}

/**
 * Fit weights by L2-regularised batch gradient descent (deterministic: zero
 * init, fixed learning rate and iteration count, no randomness).
 *
 * @param rows - Labelled training rows / 学習データ
 * @returns Trained model; means are the training-set means / 学習済みモデル
 */
export function train(rows: TrainingRow[]): PrRiskModel {
  const n = rows.length;
  const means = Object.fromEntries(
    FEATURE_KEYS.map((k) => [k, n === 0 ? 0 : rows.reduce((s, r) => s + r.features[k], 0) / n]),
  ) as FeatureVector;
  // NOTE: Trains on centred features, so the intercept b IS the baseLogit
  // (equivalent to the plan's uncentred `b + Σ w_i μ_i`); centring keeps plain
  // gradient descent stable for log-scaled sizes up to ~10.
  const centred = rows.map((r) => FEATURE_KEYS.map((k) => r.features[k] - means[k]));
  const y = rows.map((r) => (r.label === 'failure' ? 1 : 0));
  const w = FEATURE_KEYS.map(() => 0);
  let b = 0;
  for (let it = 0; it < ITERATIONS && n > 0; it++) {
    const gw = w.map(() => 0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const z = b + centred[i].reduce((s, xi, j) => s + w[j] * xi, 0);
      const err = sigmoid(z) - y[i];
      gb += err;
      for (let j = 0; j < w.length; j++) gw[j] += err * centred[i][j];
    }
    for (let j = 0; j < w.length; j++) w[j] -= LEARNING_RATE * (gw[j] / n + L2_LAMBDA * w[j]);
    b -= LEARNING_RATE * (gb / n);
  }
  const weights = Object.fromEntries(FEATURE_KEYS.map((k, j) => [k, w[j]])) as FeatureVector;
  return { baseLogit: b, weights, means };
}
