/**
 * vocab-srs unit tests — SM-2-lite schedule math.
 */
import { describe, expect, test } from 'bun:test';
import { computeNextReview, type VocabSrsState } from './vocab-srs';

const NOW = new Date('2026-08-02T00:00:00Z');
const fresh: VocabSrsState = { intervalDays: 0, easeFactor: 2.5, repetitions: 0, lapses: 0 };

const days = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 86_400_000;

describe('computeNextReview', () => {
  test('good: 1日 → 3日 → interval×ease と伸びる', () => {
    const r1 = computeNextReview(fresh, 'good', NOW);
    expect(r1.repetitions).toBe(1);
    expect(r1.intervalDays).toBe(1);
    expect(days(NOW, r1.dueAt)).toBeCloseTo(1);

    const r2 = computeNextReview(r1, 'good', NOW);
    expect(r2.intervalDays).toBe(3);

    const r3 = computeNextReview(r2, 'good', NOW);
    expect(r3.intervalDays).toBeCloseTo(3 * 2.5, 1);
  });

  test('again: 反復リセット・10分後に再出題・easeが下がる', () => {
    const learned: VocabSrsState = {
      intervalDays: 7.5,
      easeFactor: 2.5,
      repetitions: 3,
      lapses: 0,
    };
    const r = computeNextReview(learned, 'again', NOW);
    expect(r.repetitions).toBe(0);
    expect(r.intervalDays).toBe(0);
    expect(r.easeFactor).toBeCloseTo(2.3);
    expect(r.lapses).toBe(1);
    expect(r.dueAt.getTime() - NOW.getTime()).toBe(10 * 60_000);
  });

  test('again: 未学習カード(rep=0)はlapseに数えない', () => {
    const r = computeNextReview(fresh, 'again', NOW);
    expect(r.lapses).toBe(0);
  });

  test('easy: 間隔1.3倍ボーナス + ease上昇', () => {
    const r1 = computeNextReview(fresh, 'easy', NOW);
    expect(r1.easeFactor).toBeCloseTo(2.65);
    expect(r1.intervalDays).toBeCloseTo(1.3);
  });

  test('easeは1.3を下回らない', () => {
    let s: VocabSrsState = { intervalDays: 1, easeFactor: 1.35, repetitions: 2, lapses: 0 };
    s = computeNextReview(s, 'again', NOW);
    expect(s.easeFactor).toBe(1.3);
    s = computeNextReview(s, 'again', NOW);
    expect(s.easeFactor).toBe(1.3);
  });
});
