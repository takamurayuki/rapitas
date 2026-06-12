/**
 * Complexity Analyzer テスト
 *
 * タスク難易度に応じた複雑度スコアリングのユニットテスト。
 * 学習データ（DB）には依存しない純粋関数のみを対象とする。
 */
import { describe, test, expect } from 'bun:test';
import {
  analyzeTaskComplexity,
  analyzeKeywords,
  analyzeScope,
  getRecommendedMode,
} from '../../services/workflow/complexity-analyzer';

describe('complexity-analyzer', () => {
  test('trivial fix → low score / lightweight', () => {
    const r = analyzeTaskComplexity({
      title: 'ボタンの色を修正',
      description: 'プロフィール画面の保存ボタンの色を青に直す',
      priority: 'low',
    });
    expect(r.complexityScore).toBeLessThanOrEqual(35);
    expect(r.recommendedMode).toBe('lightweight');
  });

  test('large architecture task → high score / comprehensive', () => {
    const r = analyzeTaskComplexity({
      title: '認証システムのアーキテクチャを再設計',
      description:
        'OAuth2.0 対応のため認証基盤を再構築し、データベーススキーマのマイグレーション、API エンドポイントの刷新、セキュリティ強化を行う。'.repeat(
          5,
        ),
      estimatedHours: 12,
      priority: 'high',
      goals: ['OAuth2.0対応', 'リフレッシュトークン', 'SSO連携'],
      constraints: ['既存ユーザー移行', 'ダウンタイムなし'],
      acceptanceCriteria: [
        '全テスト通過',
        'セキュリティ監査合格',
        'パフォーマンス維持',
        '移行スクリプト完備',
      ],
    });
    expect(r.complexityScore).toBeGreaterThan(70);
    expect(r.recommendedMode).toBe('comprehensive');
  });

  test('difficulty ordering: trivial < medium < large', () => {
    const trivial = analyzeTaskComplexity({ title: 'タイポ修正', priority: 'low' }).complexityScore;
    const medium = analyzeTaskComplexity({
      title: 'タスク一覧にフィルタ機能を追加',
      description: 'ステータスと優先度で絞り込めるフィルタを実装する。',
      estimatedHours: 3,
      priority: 'medium',
    }).complexityScore;
    const large = analyzeTaskComplexity({
      title: 'マイクロサービス基盤を構築',
      description: 'x'.repeat(700),
      estimatedHours: 16,
      priority: 'high',
      acceptanceCriteria: ['a', 'b', 'c', 'd', 'e', 'f'],
    }).complexityScore;
    expect(trivial).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);
  });

  test('keyword matching uses word boundaries (no ASCII substring false positives)', () => {
    // "login" must NOT match lightweight "log"; "build"/"system" are heavyweight.
    const r = analyzeKeywords({ title: 'build login system' });
    expect(r.reasons.some((x) => x.includes('"log"'))).toBe(false);
    expect(r.score).toBeGreaterThan(50);
  });

  test('CJK keywords still match by substring', () => {
    const r = analyzeKeywords({ title: '認証機能を実装する' });
    expect(r.score).toBeGreaterThan(50);
  });

  test('scope: empty is neutral, more description + spec is higher', () => {
    expect(analyzeScope({ title: 't' }).score).toBe(50);
    const rich = analyzeScope({
      title: 't',
      description: 'x'.repeat(700),
      acceptanceCriteria: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
    }).score;
    expect(rich).toBeGreaterThan(80);
  });

  test('recommended mode thresholds', () => {
    expect(getRecommendedMode(20)).toBe('lightweight');
    expect(getRecommendedMode(50)).toBe('standard');
    expect(getRecommendedMode(85)).toBe('comprehensive');
  });

  test('breakdown exposes scopeScore', () => {
    const r = analyzeTaskComplexity({ title: 'x', description: 'y'.repeat(300) });
    expect(typeof r.analysisBreakdown.scopeScore).toBe('number');
  });
});
