/**
 * supervisor-agreement-selection tests
 *
 * Fixed-data checks for restoring the chosen option from an answer body:
 * real-world key and label phrasings, delimiter strictness, multi-question
 * answers and key/label disagreement.
 */
import { describe, expect, it } from 'bun:test';
import type { ParsedQuestion } from '../services/workflow/question-options-parser';
import { restoreFromBody } from './supervisor-agreement-selection';

const opt = (key: string, label: string) => ({ key, label, consequence: 'c' });
const question = (
  id: string,
  options = [opt('A', '回答と版の対応規則を再設計する')],
): ParsedQuestion => ({
  id,
  summary: `summary ${id}`,
  options: [
    ...options,
    opt('B', '限定的な読み取りの経路を定める'),
    opt('C', '推奨の完了条件に書き換える'),
  ],
  freeTextRequired: false,
  recommended: 'A',
  recommendedReason: 'r',
});
const Q1 = question('Q1');

describe('restoreFromBody: real answer phrasings', () => {
  it.each([
    ['A: 回答と版の対応規則を再設計する。理由は…', 'A', 'key'],
    ['B（限定的な読み取りの経路を定める）。理由は…', 'B', 'key'],
    ['Q1: A（影響: 版の対応を直す）', 'A', 'key'],
    ['選択: A（影響: 版の対応を直す）', 'A', 'key'],
    ['Q1: 選択: C。理由は…', 'C', 'key'],
    ['推奨の完了条件に書き換える。書き直しの案は…', 'C', 'label'],
    ['## Q1: s\n選択: 限定的な読み取りの経路を定める（影響: c）', 'B', 'label'],
  ])('%s', (body, key, source) => {
    expect(restoreFromBody(Q1, body, false)).toEqual({ key, source });
  });
});

describe('restoreFromBody: no guessing', () => {
  it('a key not followed by a delimiter is not restored', () => {
    expect(restoreFromBody(Q1, 'AとBを比べて考えた', false)).toEqual({
      reason: 'selection_not_in_options',
    });
  });
  it('a label that only appears later in the text is not restored', () => {
    const body = 'まず検討した。推奨の完了条件に書き換える案も出た。';
    expect(restoreFromBody(Q1, body, false)).toEqual({ reason: 'selection_not_in_options' });
  });
  it('an empty body is no_selection', () => {
    expect(restoreFromBody(Q1, '  \n ', false)).toEqual({ reason: 'no_selection' });
  });
  it('duplicate labels are ambiguous_label', () => {
    const q = question('Q1', [opt('A', 'same'), opt('D', 'same')]);
    expect(restoreFromBody(q, 'same を選ぶ', false)).toEqual({ reason: 'ambiguous_label' });
  });
  it('keyが一致しても同長の重複labelはambiguous_labelにする', () => {
    const q = question('Q1', [opt('A', 'A 案を採用'), opt('D', 'A 案を採用')]);
    expect(restoreFromBody(q, 'A 案を採用。', false)).toEqual({ reason: 'ambiguous_label' });
  });
  it('前方一致するlabelは一意な最長labelを採用する', () => {
    const q = question('Q1', [opt('A', '採用'), opt('D', '採用する')]);
    expect(restoreFromBody(q, '採用する。', false)).toEqual({ key: 'D', source: 'label' });
  });
  it('key and label naming different options is selection_ambiguous', () => {
    const q = question('Q1', [opt('A', '案1'), opt('D', 'A 案を採用する')]);
    expect(restoreFromBody(q, 'A 案を採用する。', false)).toEqual({
      reason: 'selection_ambiguous',
    });
  });
  it('key and label naming the same option is accepted', () => {
    const q = question('Q1', [opt('A', 'A 案を採用する')]);
    expect(restoreFromBody(q, 'A 案を採用する。', false)).toEqual({ key: 'A', source: 'key' });
  });
});

describe('restoreFromBody: several questions in one answer', () => {
  const Q2 = question('Q2');
  it('an unsectioned answer without an id prefix restores nothing', () => {
    expect(restoreFromBody(Q1, 'A: 回答と版の対応規則を再設計する', true)).toEqual({
      reason: 'no_selection',
    });
  });
  it('id-prefixed lines restore each question', () => {
    const body = 'Q1: A\nQ2: B（理由）';
    expect(restoreFromBody(Q1, body, true)).toEqual({ key: 'A', source: 'key' });
    expect(restoreFromBody(Q2, body, true)).toEqual({ key: 'B', source: 'key' });
  });
  it('sections are found by id and an empty section is no_selection', () => {
    const body = '## Q1: s\n選択: A\n\n## Q2: s\n';
    expect(restoreFromBody(Q1, body, true)).toEqual({ reason: 'selection_not_in_options' });
    expect(restoreFromBody(Q2, body, true)).toEqual({ reason: 'no_selection' });
  });
  it('節内でも質問id前置きのないkeyを復元せず、前置きのある別節は復元する', () => {
    const body = '## Q1: s\n選択: A\n\n## Q2: s\nQ2: B';
    expect(restoreFromBody(Q1, body, true)).toEqual({ reason: 'selection_not_in_options' });
    expect(restoreFromBody(Q2, body, true)).toEqual({ key: 'B', source: 'key' });
  });
  it('節内の全角id前置きと選択前置きを各一度除去する', () => {
    const body = '## Q1: s\n\nQ1： 選択： A\n\n## Q2: s\nQ2: B';
    expect(restoreFromBody(Q1, body, true)).toEqual({ key: 'A', source: 'key' });
  });
  it('節内のlabelはid前置きがなくても復元する', () => {
    const body = '## Q1: s\n選択: 回答と版の対応規則を再設計する（影響: c）';
    expect(restoreFromBody(Q1, body, true)).toEqual({ key: 'A', source: 'label' });
  });
});
