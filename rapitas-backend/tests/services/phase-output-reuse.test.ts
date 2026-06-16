/**
 * phase-output-reuse テスト
 *
 * isReusableArtifact: 再実行時に既存の research.md / plan.md を再生成せず
 * 再利用してよいかの判定（内容に問題がなければ再利用）。verify はここに
 * 渡さない（常に再生成する）方針。
 */
import { describe, test, expect } from 'bun:test';
import { isReusableArtifact } from '../../services/workflow/phase-output-validator';

const FULL_RESEARCH = [
  '# 調査結果',
  '## 影響範囲',
  'a',
  '## 依存関係',
  'b',
  '## 類似機能',
  'c',
  '## リスク評価',
  'd',
  '## テスト戦略',
  'e',
].join('\n');

const FULL_PLAN = [
  '# 実装計画',
  '## 設計判断の根拠',
  'a',
  '## 実装チェックリスト',
  '- [ ] x',
  '## 変更予定ファイル',
  '- f',
  '## リスク評価',
  'r',
  '## 完了条件',
  'd',
].join('\n');

describe('isReusableArtifact', () => {
  test('空内容は再利用しない', () => {
    expect(isReusableArtifact('research', '   ')).toBe(false);
    expect(isReusableArtifact('plan', '')).toBe(false);
  });

  test('必須セクションが揃った research は再利用する', () => {
    expect(isReusableArtifact('research', FULL_RESEARCH)).toBe(true);
  });

  test('ほぼ空（セクション欠落多数）の research は再生成する', () => {
    expect(isReusableArtifact('research', '# 調査結果\n本文のみ')).toBe(false);
  });

  test('設計判断の根拠を欠く plan は再生成する（severity≥80）', () => {
    const planNoRationale = [
      '# 実装計画',
      '## 実装チェックリスト',
      '- [ ] x',
      '## 変更予定ファイル',
      '- f',
      '## リスク評価',
      'r',
      '## 完了条件',
      'd',
    ].join('\n');
    expect(isReusableArtifact('plan', planNoRationale)).toBe(false);
  });

  test('必須セクションが揃った plan は再利用する', () => {
    expect(isReusableArtifact('plan', FULL_PLAN)).toBe(true);
  });

  test('question / その他は存在すれば再利用する', () => {
    expect(isReusableArtifact('question', 'なんらかの内容')).toBe(true);
  });
});
