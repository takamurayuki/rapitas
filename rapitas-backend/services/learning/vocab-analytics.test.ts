/**
 * vocab-analytics unit tests — retention curve, stability, recommendations.
 */
import { describe, expect, test } from 'bun:test';
import {
  buildRecommendations,
  computeHourBuckets,
  computeRetentionCurve,
  ebbinghausRetention,
  estimateStability,
  type ReviewLogRow,
} from './vocab-analytics';

const at = (hour: number) => new Date(2026, 7, 2, hour, 0, 0);

const log = (over: Partial<ReviewLogRow>): ReviewLogRow => ({
  cardId: 1,
  grade: 'good',
  elapsedDays: 2,
  repetitions: 1,
  reviewedAt: at(9),
  ...over,
});

describe('ebbinghausRetention', () => {
  test('教科書値を再現する（1日≈33%・31日≈21%）', () => {
    expect(ebbinghausRetention(1)).toBeGreaterThan(29);
    expect(ebbinghausRetention(1)).toBeLessThan(35);
    expect(ebbinghausRetention(31)).toBeGreaterThan(19);
    expect(ebbinghausRetention(31)).toBeLessThan(24);
  });
});

describe('computeRetentionCurve', () => {
  test('経過時間バケット毎に正答率を出す（rep=0の初回学習は除外）', () => {
    const logs: ReviewLogRow[] = [
      log({ elapsedDays: 0.5, grade: 'good' }),
      log({ elapsedDays: 0.5, grade: 'again' }),
      log({ elapsedDays: 2, grade: 'good' }),
      log({ elapsedDays: 2, grade: 'easy' }),
      log({ elapsedDays: 2, repetitions: 0, grade: 'again' }), // first-time — excluded
    ];
    const curve = computeRetentionCurve(logs);
    const d1 = curve.find((b) => b.key === 'd1');
    const d3 = curve.find((b) => b.key === 'd3');
    expect(d1?.rate).toBe(50);
    expect(d1?.samples).toBe(2);
    expect(d3?.rate).toBe(100);
    expect(d3?.samples).toBe(2);
    expect(curve.find((b) => b.key === 'd7')?.rate).toBeNull();
  });
});

describe('estimateStability', () => {
  test('高い定着率ほど大きなS（忘れにくい）を返す', () => {
    const strong = computeRetentionCurve(
      Array.from({ length: 20 }, (_, i) =>
        log({ elapsedDays: 5, grade: i % 10 === 0 ? 'again' : 'good' }),
      ),
    );
    const weak = computeRetentionCurve(
      Array.from({ length: 20 }, (_, i) =>
        log({ elapsedDays: 5, grade: i % 2 === 0 ? 'again' : 'good' }),
      ),
    );
    const sStrong = estimateStability(strong);
    const sWeak = estimateStability(weak);
    expect(sStrong).not.toBeNull();
    expect(sWeak).not.toBeNull();
    expect(sStrong!).toBeGreaterThan(sWeak!);
  });

  test('サンプル不足ならnull', () => {
    expect(estimateStability(computeRetentionCurve([log({})]))).toBeNull();
  });
});

describe('computeHourBuckets', () => {
  test('時間帯毎に集計される', () => {
    const logs = [
      log({ reviewedAt: at(8), grade: 'good' }),
      log({ reviewedAt: at(8), grade: 'good' }),
      log({ reviewedAt: at(21), grade: 'again' }),
    ];
    const hours = computeHourBuckets(logs);
    expect(hours.find((h) => h.key === 'morning')?.rate).toBe(100);
    expect(hours.find((h) => h.key === 'evening')?.rate).toBe(0);
    expect(hours.find((h) => h.key === 'night')?.rate).toBeNull();
  });
});

describe('buildRecommendations', () => {
  test('データ不足ならnotEnoughDataのみ', () => {
    const logs = [log({}), log({})];
    const recs = buildRecommendations(logs, computeRetentionCurve(logs), computeHourBuckets(logs));
    expect(recs).toEqual([{ key: 'notEnoughData', params: { needed: 20 } }]);
  });

  test('弱いバケットがあればreviewBeforeを提案する', () => {
    // 25 reviews at ~5 days with 40% recall → d7 bucket is weak.
    const logs = Array.from({ length: 25 }, (_, i) =>
      log({ elapsedDays: 5, grade: i % 5 < 2 ? 'good' : 'again' }),
    );
    const recs = buildRecommendations(logs, computeRetentionCurve(logs), computeHourBuckets(logs));
    expect(recs.some((r) => r.key === 'reviewBefore' && r.params?.bucket === 'd7')).toBe(true);
    expect(recs.some((r) => r.key === 'lowRetention')).toBe(true);
  });

  test('朝が夜より明確に良ければbestTimeを提案する', () => {
    const logs = [
      // morning: 12 reviews, 100%
      ...Array.from({ length: 12 }, () => log({ reviewedAt: at(9), grade: 'good' })),
      // evening: 12 reviews, ~58%
      ...Array.from({ length: 12 }, (_, i) =>
        log({ reviewedAt: at(20), grade: i % 12 < 5 ? 'again' : 'good' }),
      ),
    ];
    const recs = buildRecommendations(logs, computeRetentionCurve(logs), computeHourBuckets(logs));
    expect(recs.some((r) => r.key === 'bestTime' && r.params?.period === 'morning')).toBe(true);
  });
});
