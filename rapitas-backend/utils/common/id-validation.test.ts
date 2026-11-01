/**
 * id-validation ユニットテスト
 *
 * #1335 レビュー指摘: parseInt は読めない文字で止まるため、/tasks/5abc も
 * /tasks/5e2 も行 5 を指していた。PATCH / DELETE では「別のリソースを名指し
 * しているように見えるリクエストが、黙って行 5 を書き換える」ことになる。
 *
 * 弾くべき入力と通すべき入力の両方を固定する。片方だけだと、厳しすぎて
 * 正常なidを拒否する修正が通ってしまう。
 */
import { describe, test, expect } from 'bun:test';
import { isValidEntityId } from './id-validation';

describe('弾くべき入力', () => {
  // parseInt がそれぞれ 5 / 5 / 5 / 5 / 0 を返していたもの。
  test.each([
    ['5abc', '数字のあとにゴミ'],
    ['5e2', '指数表記'],
    ['5.9', '小数点'],
    ['5 OR 1=1', '空白とSQL片'],
    ['0x10', '16進表記'],
    ['abc', '数字なし'],
    ['', '空文字'],
    ['  5  ', '前後の空白'],
    ['\t5', 'タブ'],
    ['5\n', '改行'],
    ['+5', '正符号'],
    ['-3', '負数'],
    ['0', 'ゼロ(autoincrementは1から)'],
    ['Infinity', 'Infinity'],
    ['NaN', 'NaN'],
    ['99999999999999999999', 'MAX_SAFE_INTEGERを超える値'],
    ['9007199254740993', 'MAX_SAFE_INTEGER+2'],
    ['１２３', '全角数字'],
  ])('%p (%s)', (raw) => {
    expect(isValidEntityId(raw)).toBe(false);
  });

  test.each([[undefined], [null]])('%p', (raw) => {
    expect(isValidEntityId(raw as unknown as string)).toBe(false);
  });
});

describe('通すべき入力', () => {
  test.each([['1'], ['5'], ['42'], ['1465'], ['9007199254740991']])('%p', (raw) => {
    expect(isValidEntityId(raw)).toBe(true);
  });

  test('MAX_SAFE_INTEGER ちょうどは通ること', () => {
    expect(isValidEntityId(String(Number.MAX_SAFE_INTEGER))).toBe(true);
  });

  test('先頭ゼロ付きでも数値として妥当なら通ること', () => {
    // '007' は Number で 7。曖昧だが、既存のURLを壊す理由にはならない。
    expect(isValidEntityId('007')).toBe(true);
  });
});
