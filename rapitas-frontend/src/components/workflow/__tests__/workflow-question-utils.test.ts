/**
 * workflow-question-utils テスト
 */
import { describe, it, expect } from 'vitest';
import {
  resolveQuestionOptions,
  secondsUntil,
  DEFAULT_QUESTION_OPTIONS,
} from '../workflow-question-utils';

describe('resolveQuestionOptions', () => {
  it('エージェント提示の選択肢があればそれを使う（既定でない）', () => {
    const r = resolveQuestionOptions(['A: 最小', 'B: 標準']);
    expect(r.options).toEqual(['A: 最小', 'B: 標準']);
    expect(r.isDefault).toBe(false);
  });

  it('選択肢が無ければ既定（はい/いいえ）を合成する', () => {
    const r = resolveQuestionOptions([]);
    expect(r.options).toEqual([...DEFAULT_QUESTION_OPTIONS]);
    expect(r.isDefault).toBe(true);
  });

  it('null/空白のみは既定にフォールバックする', () => {
    expect(resolveQuestionOptions(null).isDefault).toBe(true);
    expect(resolveQuestionOptions(['  ', '']).isDefault).toBe(true);
  });

  it('空白を含む選択肢はトリムし、空要素は除外する', () => {
    const r = resolveQuestionOptions([' はい ', '', ' いいえ']);
    expect(r.options).toEqual(['はい', 'いいえ']);
    expect(r.isDefault).toBe(false);
  });
});

describe('secondsUntil', () => {
  const now = Date.parse('2026-06-18T00:00:00.000Z');
  it('期限なしは null', () => {
    expect(secondsUntil(null, now)).toBeNull();
    expect(secondsUntil(undefined, now)).toBeNull();
  });
  it('未来の期限は残り秒数', () => {
    expect(secondsUntil('2026-06-18T00:00:30.000Z', now)).toBe(30);
  });
  it('過去の期限は 0（負にしない）', () => {
    expect(secondsUntil('2026-06-17T23:59:00.000Z', now)).toBe(0);
  });
  it('不正な日付は null', () => {
    expect(secondsUntil('not-a-date', now)).toBeNull();
  });
});
