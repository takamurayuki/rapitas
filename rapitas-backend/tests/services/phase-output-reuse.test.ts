/**
 * phase-output-reuse テスト
 *
 * isReusableArtifact: 再実行時に既存の research.md / plan.md を再生成せず
 * 再利用してよいかの判定（内容に問題がなければ再利用）。verify はここに
 * 渡さない（常に再生成する）方針。
 */
import { describe, test, expect } from 'bun:test';
import {
  isReusableArtifact,
  looksLogPolluted,
  validatePlan,
} from '../../services/workflow/phase-output-validator';

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

describe('looksLogPolluted', () => {
  test('stream-json / [System:...] 混入を検出する', () => {
    expect(looksLogPolluted('# 実装計画\n[System: thinking_tokens]\n本文')).toBe(true);
    expect(looksLogPolluted('## 概要\n{"type":"assistant","message":{}}')).toBe(true);
    expect(looksLogPolluted('[Claude Code] Starting execution...\n# 計画')).toBe(true);
    expect(looksLogPolluted('[Result: completed (10s) $0.5]\n本文')).toBe(true);
  });

  test('ツールログ行が多数なら検出する', () => {
    const polluted = [
      '# 実装計画',
      '[Tool: Read] -> a.ts',
      '[Tool: Edit] -> b.ts',
      '[Tool: Bash] $ ls',
      '[Tool Done: Bash] (1s)',
      '[Tool: Grep] pattern: x',
      '[エージェント] Claude Code',
    ].join('\n');
    expect(looksLogPolluted(polluted)).toBe(true);
  });

  test('正常な plan/research は誤検出しない', () => {
    expect(looksLogPolluted(FULL_PLAN)).toBe(false);
    expect(looksLogPolluted(FULL_RESEARCH)).toBe(false);
    expect(looksLogPolluted('')).toBe(false);
  });

  test('ログ汚染した md は再利用しない・plan validator も不合格', () => {
    const broken = '# 実装計画\n[System: thinking_tokens]\n[System: init]\nゴミ';
    expect(isReusableArtifact('plan', broken)).toBe(false);
    expect(validatePlan(broken).ok).toBe(false);
    expect(validatePlan(broken).severity).toBe(100);
  });
});
