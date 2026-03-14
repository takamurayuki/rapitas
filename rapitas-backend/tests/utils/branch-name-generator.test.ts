/**
 * Branch Name Generator テスト
 * ブランチ名サニタイズ・バリデーション・フォールバック生成のテスト
 */
import { describe, test, expect } from 'bun:test';
import {
  sanitizeBranchName,
  isValidBranchName,
  generateFallbackBranchName,
  extractBranchName,
} from '../../utils/branch-name-generator';

describe('sanitizeBranchName', () => {
  test('正常なブランチ名をそのまま返すこと', () => {
    expect(sanitizeBranchName('feature/add-auth')).toBe('feature/add-auth');
  });

  test('大文字を小文字に変換すること', () => {
    expect(sanitizeBranchName('Feature/Add-Auth')).toBe('feature/add-auth');
  });

  test('特殊文字をハイフンに変換すること', () => {
    expect(sanitizeBranchName('feature/add auth!@#')).toBe('feature/add-auth');
  });

  test('連続するハイフンを1つにまとめること', () => {
    expect(sanitizeBranchName('feature/add---auth')).toBe('feature/add-auth');
  });

  test('先頭・末尾のハイフンを除去すること', () => {
    expect(sanitizeBranchName('-feature/test-name-')).toBe('feature/test-name');
  });

  test('50文字を超える場合に切り詰めること', () => {
    const longName = 'feature/' + 'a'.repeat(100);
    const result = sanitizeBranchName(longName);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  test('空文字列を処理できること', () => {
    const result = sanitizeBranchName('');
    expect(typeof result).toBe('string');
  });
});

describe('isValidBranchName', () => {
  test('有効なfeature/ブランチ名を受け入れること', () => {
    expect(isValidBranchName('feature/add-auth')).toBe(true);
  });

  test('有効なbugfix/ブランチ名を受け入れること', () => {
    expect(isValidBranchName('bugfix/fix-login')).toBe(true);
  });

  test('有効なchore/ブランチ名を受け入れること', () => {
    expect(isValidBranchName('chore/update-deps')).toBe(true);
  });

  test('空文字列を拒否すること', () => {
    expect(isValidBranchName('')).toBe(false);
  });

  test('50文字を超える名前を拒否すること', () => {
    const longName = 'feature/' + 'a'.repeat(50);
    expect(isValidBranchName(longName)).toBe(false);
  });

  test('無効なプレフィックスを拒否すること', () => {
    expect(isValidBranchName('invalid/branch')).toBe(false);
    expect(isValidBranchName('main')).toBe(false);
    expect(isValidBranchName('release/v1')).toBe(false);
  });

  test('スペースを含む名前を拒否すること', () => {
    expect(isValidBranchName('feature/add auth')).toBe(false);
  });

  test('特殊文字を含む名前を拒否すること', () => {
    expect(isValidBranchName('feature/add~auth')).toBe(false);
    expect(isValidBranchName('feature/add^auth')).toBe(false);
    expect(isValidBranchName('feature/add:auth')).toBe(false);
    expect(isValidBranchName('feature/add?auth')).toBe(false);
    expect(isValidBranchName('feature/add*auth')).toBe(false);
  });

  test('連続するドットを拒否すること', () => {
    expect(isValidBranchName('feature/add..auth')).toBe(false);
  });

  test('先頭がドットの名前を拒否すること', () => {
    expect(isValidBranchName('.feature/test')).toBe(false);
  });

  test('末尾がハイフンの名前を拒否すること', () => {
    expect(isValidBranchName('feature/test-')).toBe(false);
  });

  test('プレフィックス後に1語しかないブランチ名を拒否すること', () => {
    expect(isValidBranchName('feature/auth')).toBe(false);
    expect(isValidBranchName('bugfix/login')).toBe(false);
    expect(isValidBranchName('chore/deps')).toBe(false);
  });

  test('プレフィックス後に2語以上あるブランチ名を受け入れること', () => {
    expect(isValidBranchName('feature/add-auth')).toBe(true);
    expect(isValidBranchName('bugfix/fix-login-error')).toBe(true);
    expect(isValidBranchName('chore/update-deps')).toBe(true);
  });
});

describe('extractBranchName', () => {
  test('クリーンなブランチ名をそのまま返すこと', () => {
    expect(extractBranchName('feature/add-auth')).toBe('feature/add-auth');
  });

  test('引用符を除去すること', () => {
    expect(extractBranchName('"feature/add-auth"')).toBe('feature/add-auth');
    expect(extractBranchName("'feature/add-auth'")).toBe('feature/add-auth');
  });

  test('コードブロックを除去すること', () => {
    expect(extractBranchName('```\nfeature/add-auth\n```')).toBe('feature/add-auth');
  });

  test('バッククォートを除去すること', () => {
    expect(extractBranchName('`feature/add-auth`')).toBe('feature/add-auth');
  });

  test('説明文付きの出力から最初の行を取得すること', () => {
    expect(extractBranchName('feature/add-auth\nThis branch adds authentication')).toBe(
      'feature/add-auth',
    );
  });

  test('"branch name:" プレフィックスを除去すること', () => {
    expect(extractBranchName('Branch name: feature/add-auth')).toBe('feature/add-auth');
  });

  test('fix/ を bugfix/ に正規化すること', () => {
    expect(extractBranchName('fix/login-error')).toBe('bugfix/login-error');
  });

  test('テキスト中からブランチ名を抽出すること', () => {
    expect(extractBranchName('Here is the branch name: feature/add-auth for this task')).toBe(
      'feature/add-auth',
    );
  });
});

describe('generateFallbackBranchName', () => {
  test('英語タイトルからfeature/プレフィックスのブランチ名を生成すること', () => {
    const result = generateFallbackBranchName('Add user authentication');
    expect(result.startsWith('feature/')).toBe(true);
    expect(result).toContain('add');
    expect(result).toContain('user');
    expect(result).toContain('authentication');
  });

  test('バグ関連キーワードでbugfix/プレフィックスを使用すること', () => {
    const result = generateFallbackBranchName('Fix login error');
    expect(result.startsWith('bugfix/')).toBe(true);
  });

  test('日本語のバグキーワードでbugfix/プレフィックスを使用すること', () => {
    const result = generateFallbackBranchName('ログインバグを修正');
    expect(result.startsWith('bugfix/')).toBe(true);
  });

  test('chore関連キーワードでchore/プレフィックスを使用すること', () => {
    const result = generateFallbackBranchName('Refactor database layer');
    expect(result.startsWith('chore/')).toBe(true);
  });

  test('日本語のchoreキーワードでchore/プレフィックスを使用すること', () => {
    const result = generateFallbackBranchName('依存関係を更新する');
    expect(result.startsWith('chore/')).toBe(true);
  });

  test('生成されたブランチ名がバリデーションを通ること', () => {
    const result = generateFallbackBranchName('Add new feature');
    expect(isValidBranchName(result)).toBe(true);
  });

  test('空のタイトルでもデフォルト名を生成すること', () => {
    const result = generateFallbackBranchName('');
    expect(result.length).toBeGreaterThan(0);
    expect(isValidBranchName(result)).toBe(true);
  });

  test('1語のタイトルでも2語以上のブランチ名を生成すること', () => {
    const result = generateFallbackBranchName('Auth');
    expect(isValidBranchName(result)).toBe(true);
    // slug部分にハイフンが含まれていること（2語以上）
    const slug = result.substring(result.indexOf('/') + 1);
    expect(slug).toContain('-');
  });
});
