/**
 * criteria-proposal tests (companion design stage 1, item 1)
 */
import { describe, expect, test } from 'bun:test';
import {
  normalizeCriteria,
  ensureProposedCriteria,
  criteriaFromDescription,
  MAX_CRITERIA,
} from './criteria-proposal';

describe('normalizeCriteria', () => {
  test('trims, drops blanks, non-strings and duplicates, keeps order', () => {
    expect(normalizeCriteria([' a ', '', 'b', 3, 'a', null])).toEqual(['a', 'b']);
  });
  test('bounds the count and is empty for a non-array', () => {
    expect(normalizeCriteria(Array.from({ length: 20 }, (_, i) => `c${i}`))).toHaveLength(
      MAX_CRITERIA,
    );
    expect(normalizeCriteria('a')).toEqual([]);
  });
});

describe('ensureProposedCriteria', () => {
  test('keeps a real proposal', () => {
    expect(ensureProposedCriteria(['x'], 't')).toEqual({ criteria: ['x'], fallback: false });
  });
  test('falls back to one criterion naming the task', () => {
    const out = ensureProposedCriteria([], '歯医者を予約');
    expect(out.fallback).toBe(true);
    expect(out.criteria).toHaveLength(1);
    expect(out.criteria[0]).toContain('「歯医者を予約」');
  });
});

describe('criteriaFromDescription', () => {
  test('reads the checklist under ## 完了条件 only', () => {
    const d = 'やる\n\n## 完了条件\n- [ ] 一つ目\n- [x] 二つ目\n- 三つ目\n\n## メモ\n- これは違う';
    expect(criteriaFromDescription(d)).toEqual(['一つ目', '二つ目', '三つ目']);
  });
  test('nothing without the heading', () => {
    expect(criteriaFromDescription('## 受入基準\n- a')).toEqual([]);
    expect(criteriaFromDescription(undefined)).toEqual([]);
  });
});
