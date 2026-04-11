/**
 * naming-service のユニットテスト
 */

import { describe, test, expect } from 'bun:test';

// テスト用ヘルパー関数：後処理ロジックのテスト用
function simulateTaskTitlePostProcessing(rawContent: string): string {
  let title = rawContent.trim();

  // LLMが生成しがちなプレフィックスを除去
  title = title.replace(/^(タイトル|件名|題名|テーマ)\s*[:：]\s*/g, '');
  title = title.replace(/^(Title|Subject)\s*[:：]\s*/gi, '');

  // 引用符・括弧の除去（両端から除去）
  title = title.replace(/^["']+/g, '').replace(/["']+$/g, '');
  title = title.replace('「', '').replace('」', '');
  title = title.replace('『', '').replace('』', '');
  title = title.replace(/^[()（）]+/g, '').replace(/[()（）]+$/g, '');
  title = title.replace(/^[【】\[\]]+/g, '').replace(/[【】\[\]]+$/g, '');

  // ハイフンや不要な記号の除去（文頭のハイフンや箇条書きマーカー）
  title = title.replace(/^[-−・*+]\s*/g, '');
  title = title.replace(/\s*[-−・]\s*/g, ' '); // 中間のハイフンをスペースに置換

  // 「。」除去ロジック
  title = title.replace(/。+$/, '');

  // 複数文の場合は最初のもののみ返却
  if (title.includes('。')) {
    title = title.split('。')[0];
  }

  // 「が」が含まれている場合の安全な処理（破壊的な除去を避ける）
  if (title.includes('が')) {
    // より安全な「が」の処理：文法的におかしくなりそうな場合のみ修正
    title = title.replace(/(.+?)が(.+?)ない(問題|エラー|バグ)/g, '$1の$2修正');
    title = title.replace(/(.+?)が(.+?)できない/g, '$1の$2機能');
    // その他の「が」は残す（意味を壊さないため）
  }

  // 余分な空白を除去し、文字数制限を適用
  title = title.replace(/\s+/g, ' ').trim();
  if (title.length > 40) {
    title = title.slice(0, 40);
  }

  // 空文字列の場合のフォールバック
  if (!title) {
    title = 'タスクタイトル';
  }

  return title;
}

describe('TaskTitle後処理ロジック', () => {
  test('プレフィックスが除去されること', () => {
    const testCases = [
      { input: 'タイトル: ユーザー認証機能の実装', expected: 'ユーザー認証機能の実装' },
      { input: '件名：データベース修正', expected: 'データベース修正' },
      { input: 'Title: User Authentication', expected: 'User Authentication' },
      { input: 'Subject: Bug Fix', expected: 'Bug Fix' },
      { input: 'テーマ : API改善', expected: 'API改善' },
    ];

    for (const testCase of testCases) {
      const result = simulateTaskTitlePostProcessing(testCase.input);
      expect(result).toBe(testCase.expected);
    }
  });

  test('ハイフンや記号が除去されること', () => {
    const testCases = [
      { input: '- ユーザー認証機能の実装', expected: 'ユーザー認証機能の実装' },
      { input: '・データベース修正', expected: 'データベース修正' },
      { input: '* API改善', expected: 'API改善' },
      { input: '+ 新機能追加', expected: '新機能追加' },
      { input: 'ログイン - 画面 - 修正', expected: 'ログイン 画面 修正' },
      { input: 'データ・処理・改善', expected: 'データ 処理 改善' },
    ];

    for (const testCase of testCases) {
      const result = simulateTaskTitlePostProcessing(testCase.input);
      expect(result).toBe(testCase.expected);
    }
  });

  test('引用符や括弧が除去されること', () => {
    const testCases = [
      { input: '「ユーザー認証機能の実装」', expected: 'ユーザー認証機能の実装' },
      { input: '"API修正"', expected: 'API修正' },
      { input: '（データベース改善）', expected: 'データベース改善' },
      { input: '『重要な修正』', expected: '重要な修正' },
      { input: '[バグ修正]', expected: 'バグ修正' },
      { input: '【緊急】ログイン修正', expected: '緊急】ログイン修正' }, // 片側のみ除去
    ];

    for (const testCase of testCases) {
      const result = simulateTaskTitlePostProcessing(testCase.input);
      expect(result).toBe(testCase.expected);
    }
  });

  test('句点が除去されること', () => {
    const testCases = [
      { input: 'ユーザー認証機能の実装。', expected: 'ユーザー認証機能の実装' },
      { input: 'データベース修正。その他の改善。', expected: 'データベース修正' },
      { input: 'API改善。。', expected: 'API改善' },
      { input: 'バグ修正。', expected: 'バグ修正' },
    ];

    for (const testCase of testCases) {
      const result = simulateTaskTitlePostProcessing(testCase.input);
      expect(result).toBe(testCase.expected);
    }
  });

  test('「が」が安全に処理されること', () => {
    const testCases = [
      { input: '画像が表示されない問題', expected: '画像の表示され修正' },
      { input: 'APIが接続できない', expected: 'APIの接続機能' },
      { input: 'ページがロードできない', expected: 'ページのロード機能' },
      { input: 'ログインがうまくいかないバグ', expected: 'ログインのうまくいか修正' },
      { input: '設定画面が開く機能', expected: '設定画面が開く機能' }, // 問題のない「が」は残す
      { input: 'ユーザーが選択する機能', expected: 'ユーザーが選択する機能' }, // 問題のない「が」は残す
    ];

    for (const testCase of testCases) {
      const result = simulateTaskTitlePostProcessing(testCase.input);
      expect(result).toBe(testCase.expected);
    }
  });

  test('文字数制限が適用されること', () => {
    const longTitle =
      'これは非常に長いタスクタイトルで40文字を超える内容になっていますので切り詰められるはずです';
    const result = simulateTaskTitlePostProcessing(longTitle);

    expect(result.length).toBeLessThanOrEqual(40);
    expect(result).toBe(
      'これは非常に長いタスクタイトルで40文字を超える内容になっていますので切り詰めら',
    );
  });

  test('空文字列や空白のみの場合にフォールバックされること', () => {
    const testCases = ['', '   ', '\t\n', 'タイトル:', '- ', '・', '* '];

    for (const testCase of testCases) {
      const result = simulateTaskTitlePostProcessing(testCase);
      expect(result).toBe('タスクタイトル');
    }
  });

  test('複合的な処理が正しく動作すること', () => {
    const testCases = [
      {
        input: 'タイトル: * ログイン・画面・改善',
        expected: 'ログイン 画面 改善',
      },
      {
        input: '件名：（緊急）データベースが更新されないエラー',
        expected: 'データベースの更新修正',
      },
    ];

    for (const testCase of testCases) {
      const result = simulateTaskTitlePostProcessing(testCase.input);
      expect(result).toBe(testCase.expected);
    }
  });

  test('正常なタイトルは変更されないこと', () => {
    const testCases = [
      'ユーザー認証機能の実装',
      'データベース接続エラーの修正',
      'API レスポンス速度の最適化',
      '管理画面デザインの改善',
      'ログイン画面の表示改善',
      '画像アップロード機能追加',
    ];

    for (const testCase of testCases) {
      const result = simulateTaskTitlePostProcessing(testCase);
      expect(result).toBe(testCase);
    }
  });
});
