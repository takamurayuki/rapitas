/**
 * NamingService Tests
 *
 * Tests for cleanGeneratedTitle() post-processing logic in naming-service.ts.
 * AI generation itself is not tested here (LLM-dependent); focus is on output cleaning.
 */
import { describe, test, expect } from 'bun:test';
import { cleanGeneratedTitle } from '../../utils/common/title-cleaner';

describe('cleanGeneratedTitle', () => {
  // ── 基本的なクリーニング ──────────────────────────────────────────────

  test('正常なタイトルはそのまま返す', () => {
    expect(cleanGeneratedTitle('ユーザー認証機能の実装')).toBe('ユーザー認証機能の実装');
  });

  test('前後の空白を除去する', () => {
    expect(cleanGeneratedTitle('  タスク一覧の改善  ')).toBe('タスク一覧の改善');
  });

  // ── 引用符・括弧の除去 ───────────────────────────────────────────────

  test('日本語引用符を除去する', () => {
    expect(cleanGeneratedTitle('「ユーザー認証機能の実装」')).toBe('ユーザー認証機能の実装');
  });

  test('二重引用符を除去する', () => {
    expect(cleanGeneratedTitle('"タスク管理の改善"')).toBe('タスク管理の改善');
  });

  test('シングルクォートを除去する', () => {
    expect(cleanGeneratedTitle("'API最適化'")).toBe('API最適化');
  });

  test('角括弧を除去する', () => {
    expect(cleanGeneratedTitle('【ダッシュボード改善】')).toBe('ダッシュボード改善');
  });

  // ── プレフィックスの除去 ─────────────────────────────────────────────

  test('「タイトル:」プレフィックスを除去する', () => {
    expect(cleanGeneratedTitle('タイトル: ユーザー認証の実装')).toBe('ユーザー認証の実装');
  });

  test('「タイトル：」全角コロンのプレフィックスを除去する', () => {
    expect(cleanGeneratedTitle('タイトル：メール通知の改善')).toBe('メール通知の改善');
  });

  test('「title:」英語プレフィックスを除去する', () => {
    expect(cleanGeneratedTitle('title: Task management improvement')).toBe(
      'Task management improvement',
    );
  });

  test('番号プレフィックスを除去する', () => {
    expect(cleanGeneratedTitle('1. ユーザー認証の実装')).toBe('ユーザー認証の実装');
    expect(cleanGeneratedTitle('2) データベース最適化')).toBe('データベース最適化');
  });

  test('箇条書きプレフィックスを除去する', () => {
    expect(cleanGeneratedTitle('- タスク一覧の改善')).toBe('タスク一覧の改善');
    expect(cleanGeneratedTitle('・API設計の見直し')).toBe('API設計の見直し');
  });

  // ── 句読点の除去 ────────────────────────────────────────────────────

  test('末尾の句点を除去する', () => {
    expect(cleanGeneratedTitle('ユーザー認証機能の実装。')).toBe('ユーザー認証機能の実装');
  });

  test('末尾の感嘆符を除去する', () => {
    expect(cleanGeneratedTitle('パフォーマンス改善！')).toBe('パフォーマンス改善');
  });

  test('複数文の場合は最初の文のみ返す', () => {
    expect(cleanGeneratedTitle('認証機能の実装。セキュリティも強化する')).toBe('認証機能の実装');
  });

  // ── ハイフン処理 ────────────────────────────────────────────────────

  test('英語のハイフン区切りをスペース区切りに変換する', () => {
    expect(cleanGeneratedTitle('user-auth-implementation')).toBe('user auth implementation');
  });

  test('日本語テキスト中のハイフン区切りをスペースに変換する', () => {
    expect(cleanGeneratedTitle('ユーザー認証 - 実装')).toBe('ユーザー認証 実装');
  });

  test('ダッシュ(—)も除去する', () => {
    expect(cleanGeneratedTitle('タスク管理 — 改善')).toBe('タスク管理 改善');
  });

  // ── 複数行処理 ──────────────────────────────────────────────────────

  test('複数行の場合は最初の行のみ使用する', () => {
    expect(cleanGeneratedTitle('ユーザー認証の実装\n詳細な説明テキスト')).toBe(
      'ユーザー認証の実装',
    );
  });

  // ── 40文字制限 ──────────────────────────────────────────────────────

  test('40文字以内のタイトルはそのまま返す', () => {
    const title = 'あ'.repeat(40);
    expect(cleanGeneratedTitle(title)).toBe(title);
  });

  test('40文字を超えるタイトルは切り詰める', () => {
    const title = 'あ'.repeat(50);
    expect(cleanGeneratedTitle(title).length).toBeLessThanOrEqual(40);
  });

  test('長いタイトルを助詞の位置で自然に切り詰める', () => {
    // 25文字目に「の」がある
    const title =
      'ユーザー認証機能における多要素認証の導入とセキュリティ強化に関する包括的な設計と実装';
    const result = cleanGeneratedTitle(title);
    expect(result.length).toBeLessThanOrEqual(40);
  });

  // ── 複合的なケース ──────────────────────────────────────────────────

  test('引用符とプレフィックスの組み合わせ', () => {
    expect(cleanGeneratedTitle('タイトル: 「メール通知の改善」')).toBe('メール通知の改善');
  });

  test('番号付き引用符付きタイトル', () => {
    expect(cleanGeneratedTitle('1. 「ダッシュボード表示の最適化」')).toBe(
      'ダッシュボード表示の最適化',
    );
  });

  test('空文字列の場合は空文字列を返す', () => {
    expect(cleanGeneratedTitle('')).toBe('');
  });

  test('空白のみの場合は空文字列を返す', () => {
    expect(cleanGeneratedTitle('   ')).toBe('');
  });

  test('連続スペースを正規化する', () => {
    expect(cleanGeneratedTitle('タスク   管理の  改善')).toBe('タスク 管理の 改善');
  });
});
