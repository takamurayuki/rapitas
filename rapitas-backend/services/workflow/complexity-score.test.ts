/**
 * complexity-score テスト
 *
 * One resolver for "which complexity does this task have", shared by the
 * workflow-mode selection and SmartRouter so a missing score means the same
 * safe default (50) in both places.
 */
import { describe, test, expect } from 'bun:test';
import { DEFAULT_COMPLEXITY_SCORE, resolveComplexityScore } from './complexity-score';

describe('resolveComplexityScore', () => {
  test('既定値は 50', () => {
    expect(DEFAULT_COMPLEXITY_SCORE).toBe(50);
  });

  test('読めた値はそのまま使う（0 も有効な評価として残す）', () => {
    expect(resolveComplexityScore(78)).toEqual({ score: 78, assessed: true });
    expect(resolveComplexityScore(0)).toEqual({ score: 0, assessed: true });
    expect(resolveComplexityScore(100)).toEqual({ score: 100, assessed: true });
  });

  test('欠落・読めない値は安全側の既定 50', () => {
    for (const raw of [null, undefined, Number.NaN, -1, 101, 12.5]) {
      expect(resolveComplexityScore(raw)).toEqual({ score: 50, assessed: false });
    }
  });
});
