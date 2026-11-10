/**
 * research-complexity テスト
 *
 * The parser reads ONLY the `## 複雑度評価` section, the same way
 * research-risk.ts reads only `## リスク判定`.
 */
import { describe, test, expect } from 'bun:test';
import { parseResearchComplexity } from './research-complexity';

const section = (body: string) => `# 調査レポート\n...\n## 複雑度評価\n${body}\n`;

describe('parseResearchComplexity', () => {
  test('プロンプト形式（## 複雑度評価 / スコア: NN）を抽出', () => {
    const md = '# 調査レポート\n...\n## 複雑度評価\nスコア: 65\n理由: 5ファイル変更';
    expect(parseResearchComplexity(md)).toBe(65);
  });

  test('節の中の「スコア：72 / 100」形式も可', () => {
    expect(parseResearchComplexity(section('スコア：72 / 100'))).toBe(72);
  });

  test('節の中の「複雑度: 30」形式も可', () => {
    expect(parseResearchComplexity(section('複雑度: 30'))).toBe(30);
  });

  test('英語の見出しと「complexity score 88」も可', () => {
    expect(parseResearchComplexity('## Complexity assessment\nComplexity score 88\n')).toBe(88);
  });

  test('範囲外(>100)や欠落は null', () => {
    expect(parseResearchComplexity(section('スコア: 150'))).toBeNull();
    expect(parseResearchComplexity(section('特にスコアの記載なし'))).toBeNull();
    expect(parseResearchComplexity('')).toBeNull();
    expect(parseResearchComplexity(null)).toBeNull();
  });

  test('0 と 100 の境界値を受理', () => {
    expect(parseResearchComplexity(section('スコア: 0'))).toBe(0);
    expect(parseResearchComplexity(section('スコア: 100'))).toBe(100);
  });

  // Reproduction from routing-eval §1.2: a whole-document match read the
  // "信頼度スコア 0.8" in the body and returned 0 instead of 78.
  test('節より前の本文にある別の「スコア」を拾わない（本来78が0になる誤読の再現）', () => {
    const md =
      '# 調査レポート\n## 既存実装\n既存の信頼度スコア 0.8 を閾値に使っている。\n\n' +
      '## 複雑度評価\nスコア: 78\n理由: 8ファイル\n';
    expect(parseResearchComplexity(md)).toBe(78);
  });

  test('節の後ろの別の節にある数字も拾わない', () => {
    const md = '## 複雑度評価\n理由のみ記載\n\n## リスク判定\nリスク: 低\nスコア: 12\n';
    expect(parseResearchComplexity(md)).toBeNull();
  });

  test('複雑度評価の節が無ければ、本文に「スコア: NN」があっても null', () => {
    expect(parseResearchComplexity('# 調査\nテストのスコア: 40 を確認した')).toBeNull();
    expect(parseResearchComplexity('スコア：72 / 100')).toBeNull();
  });
});
