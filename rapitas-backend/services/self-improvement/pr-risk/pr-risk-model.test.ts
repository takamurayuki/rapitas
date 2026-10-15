/**
 * pr-risk-model test
 *
 * Pins the linear logistic model and its closed-form SHAP values: additivity
 * (Σφ = logit − base), main-factor ranking per feature, deterministic training.
 */
import { describe, it, expect } from 'bun:test';
import { PRIOR_MODEL, predict, train, parseModel, logit, sigmoid } from './pr-risk-model';
import type { FeatureVector, TrainingRow } from './pr-risk-types';

const atMeans = (): FeatureVector => ({ ...PRIOR_MODEL.means });

describe('prior model', () => {
  it('uses baseLogit −2.2 (≈10% base failure rate)', () => {
    expect(PRIOR_MODEL.baseLogit).toBe(-2.2);
    expect(sigmoid(-2.2)).toBeCloseTo(0.1, 2);
  });

  it('parseModel falls back to the prior on null / broken JSON', () => {
    expect(parseModel(null)).toEqual(PRIOR_MODEL);
    expect(parseModel('{not json')).toEqual(PRIOR_MODEL);
    expect(parseModel(JSON.stringify({ baseLogit: 1 }))).toEqual(PRIOR_MODEL);
  });
});

describe('predict / SHAP', () => {
  it('is additive: baseLogit + Σφ equals logit(score)', () => {
    const x: FeatureVector = {
      file_size: 7.2,
      files_changed: 3.1,
      author: 1,
      dependency_change: 1,
      schema_change: 0,
    };
    const p = predict(PRIOR_MODEL, x);
    const sum = p.baseLogit + p.contributions.reduce((s, c) => s + c.phi, 0);
    expect(Math.abs(sum - logit(p.score))).toBeLessThan(1e-9);
    expect(p.contributions).toHaveLength(5);
  });

  it('returns φ = 0 for every feature at the means (score = base rate)', () => {
    const p = predict(PRIOR_MODEL, atMeans());
    expect(p.contributions.every((c) => c.phi === 0)).toBe(true);
    expect(p.score).toBeCloseTo(sigmoid(-2.2), 12);
  });

  it('identifies dependency_change as the main factor', () => {
    const p = predict(PRIOR_MODEL, { ...atMeans(), dependency_change: 1 });
    expect(p.contributions[0].feature).toBe('dependency_change');
    expect(p.contributions[0].phi).toBeCloseTo(0.8 * 0.9, 12);
  });

  it('identifies file_size as the main factor for a huge diff', () => {
    const p = predict(PRIOR_MODEL, { ...atMeans(), file_size: 10 });
    expect(p.contributions[0].feature).toBe('file_size');
    expect(p.contributions[0].phi).toBeCloseTo(3, 12);
  });

  it('identifies author as the main factor for a human PR', () => {
    const p = predict(PRIOR_MODEL, { ...atMeans(), author: 1 });
    expect(p.contributions[0].feature).toBe('author');
  });

  it('sorts contributions by |φ| descending (negative φ ranks by magnitude)', () => {
    const p = predict(PRIOR_MODEL, { ...atMeans(), file_size: 0, dependency_change: 1 });
    // file_size φ = 0.6 × (0 − 5) = −3 → larger magnitude than dependency's 0.72
    expect(p.contributions[0].feature).toBe('file_size');
    expect(p.contributions[0].phi).toBeLessThan(0);
    expect(p.contributions[1].feature).toBe('dependency_change');
  });
});

describe('train', () => {
  const rows: TrainingRow[] = Array.from({ length: 40 }, (_, i) => ({
    features: {
      file_size: i % 2 === 0 ? 8 : 3,
      files_changed: 2,
      author: 0,
      dependency_change: i % 4 === 0 ? 1 : 0,
      schema_change: 0,
    },
    label: i % 4 === 0 ? 'failure' : 'success',
  }));

  it('is deterministic for the same input', () => {
    expect(train(rows)).toEqual(train(rows));
  });

  it('learns a positive weight for the feature that separates failures', () => {
    const m = train(rows);
    expect(m.weights.dependency_change).toBeGreaterThan(0);
    // means are the training-set means
    expect(m.means.dependency_change).toBeCloseTo(0.25, 12);
    const failing = predict(m, rows[0].features).score;
    const passing = predict(m, rows[1].features).score;
    expect(failing).toBeGreaterThan(passing);
  });

  it('keeps additivity after training', () => {
    const m = train(rows);
    const p = predict(m, rows[3].features);
    const sum = p.baseLogit + p.contributions.reduce((s, c) => s + c.phi, 0);
    expect(Math.abs(sum - logit(p.score))).toBeLessThan(1e-9);
  });
});
