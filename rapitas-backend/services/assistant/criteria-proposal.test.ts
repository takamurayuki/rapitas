/**
 * criteria-proposal tests (companion design 段B, stage 1 item 1)
 */
import { describe, expect, test } from 'bun:test';
import {
  normalizeCriteria,
  ensureProposedCriteria,
  criteriaFromDescription,
  proposeCriteria,
  classifyVerifier,
  findVagueTerm,
  withoutCriteriaSection,
  MAX_CRITERIA,
  MIN_PROPOSED_CRITERIA,
  MAX_PROPOSED_CRITERIA,
} from './criteria-proposal';
import { checkSpecQuality } from '../intake/spec-quality-checker';

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
  test('keeps a real proposal first, supplemented to three', () => {
    const out = ensureProposedCriteria(['x'], 't');
    expect(out.fallback).toBe(false);
    expect(out.criteria[0]).toBe('x');
    expect(out.criteria).toHaveLength(MIN_PROPOSED_CRITERIA);
  });
  test('falls back to three criteria naming the task, not one generic line', () => {
    const out = ensureProposedCriteria([], '歯医者を予約');
    expect(out.fallback).toBe(true);
    expect(out.criteria).toHaveLength(3);
    for (const c of out.criteria) expect(c).toContain('「歯医者を予約」');
    expect(new Set(out.criteria).size).toBe(3);
  });
});

describe('proposeCriteria (段B)', () => {
  test('3〜7: three or more proposed are kept as they are, more than seven cut', () => {
    const three = ['a が表示される', 'b が保存される', 'c が送信される'];
    expect(proposeCriteria({ title: 't', proposed: three }).criteria).toEqual(three);
    expect(proposeCriteria({ title: 't', proposed: three }).supplemented).toBe(0);
    const nine = Array.from({ length: 9 }, (_, i) => `項目${i}が一覧に出る`);
    expect(proposeCriteria({ title: 't', proposed: nine }).criteria).toHaveLength(
      MAX_PROPOSED_CRITERIA,
    );
  });

  test('supplements come from the goals and constraints before the generic sentences', () => {
    const out = proposeCriteria({
      title: '請求書の発行',
      proposed: [],
      goals: JSON.stringify(['月末に請求書を送れる']),
      constraints: ['既存の顧客データを変えない'],
    });
    expect(out.criteria[0]).toContain('月末に請求書を送れる');
    expect(out.criteria[1]).toContain('既存の顧客データを変えない');
    expect(out.items.every((i) => i.supplemented)).toBe(true);
  });

  test('each item carries a verifier mark and, when vague, a rewording hint', () => {
    const out = proposeCriteria({
      title: 't',
      proposed: ['画面が使いやすい', 'API が 200 を返す', '本人が見て納得できる'],
    });
    expect(out.items.map((i) => i.verifier)).toEqual(['jury', 'jury', 'user']);
    expect(out.items[0].vague).toEqual({
      term: '使いやすい',
      suggestion: expect.stringContaining('タップ'),
    });
    expect(out.items[1].vague).toBeUndefined();
  });

  test('the score is spec-quality-checker’s for the spec carrying these criteria', () => {
    const input = { title: 't', proposed: ['a が出る'], description: 'x'.repeat(60), goals: ['g'] };
    const out = proposeCriteria(input);
    const expected = checkSpecQuality({
      description: input.description,
      goals: input.goals,
      constraints: null,
      acceptanceCriteria: out.criteria,
    });
    expect(out.quality.score).toBe(expected.score);
    expect(out.quality.isAdequate).toBe(expected.isAdequate);
  });

  test('vague items are counted and named in the reasons', () => {
    const out = proposeCriteria({
      title: 't',
      proposed: ['速く動く', 'きちんと動く', 'ログが出る'],
    });
    expect(out.quality.vagueCount).toBe(2);
    expect(out.quality.reasons.some((r) => r.includes('速く動く'))).toBe(true);
  });
});

describe('classifyVerifier / findVagueTerm', () => {
  test('judgement calls only the person can make are marked user', () => {
    expect(classifyVerifier('ユーザーが自分で試して満足できる')).toBe('user');
    expect(classifyVerifier('ビルドが通る')).toBe('jury');
  });
  test('plain checkable sentences have no vague term', () => {
    expect(findVagueTerm('3タップ以内で登録できる')).toBeNull();
    expect(findVagueTerm('表示が改善される')?.term).toBe('改善する');
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

describe('withoutCriteriaSection', () => {
  test('removes only that section', () => {
    expect(withoutCriteriaSection('やる\n\n## 完了条件\n- [ ] a\n\n## メモ\n- b')).toBe(
      'やる\n\n## メモ\n- b',
    );
    expect(withoutCriteriaSection('やる')).toBe('やる');
  });
});
