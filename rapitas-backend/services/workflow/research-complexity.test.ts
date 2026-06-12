/**
 * research-complexity テスト
 */
import { describe, test, expect } from 'bun:test';
import { parseResearchComplexity } from './research-complexity';

describe('parseResearchComplexity', () => {
  test('プロンプト形式（## 複雑度評価 / スコア: NN）を抽出', () => {
    const md = '# 調査レポート\n...\n## 複雑度評価\nスコア: 65\n理由: 5ファイル変更';
    expect(parseResearchComplexity(md)).toBe(65);
  });

  test('「スコア：72 / 100」形式も可', () => {
    expect(parseResearchComplexity('スコア：72 / 100')).toBe(72);
  });

  test('「複雑度: 30」形式も可', () => {
    expect(parseResearchComplexity('複雑度: 30')).toBe(30);
  });

  test('英語「complexity score 88」も可', () => {
    expect(parseResearchComplexity('Complexity score 88')).toBe(88);
  });

  test('範囲外(>100)や欠落は null', () => {
    expect(parseResearchComplexity('スコア: 150')).toBeNull();
    expect(parseResearchComplexity('特にスコアの記載なし')).toBeNull();
    expect(parseResearchComplexity('')).toBeNull();
    expect(parseResearchComplexity(null)).toBeNull();
  });

  test('0 と 100 の境界値を受理', () => {
    expect(parseResearchComplexity('スコア: 0')).toBe(0);
    expect(parseResearchComplexity('スコア: 100')).toBe(100);
  });
});
