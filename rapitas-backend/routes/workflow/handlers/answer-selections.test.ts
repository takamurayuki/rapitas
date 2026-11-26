/**
 * answer-selections — parsing the per-question choices sent with an answer
 *
 * 2026-11-26: the operator sent `selections` as `{"criteria":"adopt"}` instead
 * of `[{"questionId":"criteria","selectedKey":"adopt"}]`. The object was
 * dropped without a word, the answer returned ok, and 「推奨の完了条件に書き換える」
 * never rewrote the criteria (tasks 1552 and 1560), so the diff-review jury
 * kept judging against the criterion everyone had agreed to replace.
 */
import { describe, it, expect } from 'bun:test';
import { isMalformedSelections, parseSelections } from './answer-selections';

describe('parseSelections', () => {
  it('reads the array form', () => {
    expect(parseSelections([{ questionId: 'criteria', selectedKey: 'adopt' }])).toEqual([
      { questionId: 'criteria', selectedKey: 'adopt' },
    ]);
  });
});

describe('isMalformedSelections', () => {
  it('flags an object map that would otherwise be dropped silently', () => {
    expect(isMalformedSelections({ criteria: 'adopt' })).toBe(true);
  });

  it('flags an array whose items carry no question id', () => {
    expect(isMalformedSelections([{ key: 'A' }])).toBe(true);
  });

  it('accepts the array form, an empty array, and an absent field', () => {
    expect(isMalformedSelections([{ questionId: 'Q1', selectedKey: 'A' }])).toBe(false);
    expect(isMalformedSelections([])).toBe(false);
    expect(isMalformedSelections(undefined)).toBe(false);
    expect(isMalformedSelections(null)).toBe(false);
  });
});
