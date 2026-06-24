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
} from '../../utils/common/branch-name-generator';

// ---------------------------------------------------------------------------
// sanitizeBranchName
// ---------------------------------------------------------------------------

type SanitizeCase = { input: string; expected: string };

/** 単純な in→out アサーション（toBe）をテーブル化 */
const sanitizeBranchNameCases: SanitizeCase[] = [
  { input: 'feature/add-auth',     expected: 'feature/add-auth'  },  // 正常なブランチ名
  { input: 'Feature/Add-Auth',     expected: 'feature/add-auth'  },  // 大文字→小文字
  { input: 'feature/add auth!@#',  expected: 'feature/add-auth'  },  // 特殊文字→ハイフン
  { input: 'feature/add---auth',   expected: 'feature/add-auth'  },  // 連続ハイフン→1つ
  { input: '-feature/test-name-',  expected: 'feature/test-name' },  // 先頭・末尾ハイフン除去
];

describe('sanitizeBranchName', () => {
  test.each(sanitizeBranchNameCases)('$input → $expected', ({ input, expected }) => {
    expect(sanitizeBranchName(input)).toBe(expected);
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

// ---------------------------------------------------------------------------
// isValidBranchName
// ---------------------------------------------------------------------------

type ValidCase = { name: string; input: string; expected: boolean };

/** isValidBranchName の全入出力ケースをテーブル化 */
const isValidBranchNameCases: ValidCase[] = [
  // 有効なプレフィックス
  { name: 'feature/add-auth（有効なfeature/プレフィックス）', input: 'feature/add-auth',      expected: true  },
  { name: 'bugfix/fix-login（有効なbugfix/プレフィックス）', input: 'bugfix/fix-login',       expected: true  },
  { name: 'chore/update-deps（有効なchore/プレフィックス）', input: 'chore/update-deps',      expected: true  },
  // 空文字列・長さ
  { name: '空文字列',                                         input: '',                       expected: false },
  { name: '50文字超（feature/aaa...×50）',                    input: 'feature/' + 'a'.repeat(50), expected: false },
  // 無効なプレフィックス
  { name: '無効なプレフィックス: invalid/branch',             input: 'invalid/branch',         expected: false },
  { name: '無効なプレフィックス: main',                       input: 'main',                   expected: false },
  { name: '無効なプレフィックス: release/v1',                 input: 'release/v1',             expected: false },
  // スペース・特殊文字
  { name: 'スペースを含む: feature/add auth',                 input: 'feature/add auth',       expected: false },
  { name: '特殊文字: チルダ（feature/add~auth）',             input: 'feature/add~auth',       expected: false },
  { name: '特殊文字: キャレット（feature/add^auth）',         input: 'feature/add^auth',       expected: false },
  { name: '特殊文字: コロン（feature/add:auth）',             input: 'feature/add:auth',       expected: false },
  { name: '特殊文字: クエスチョン（feature/add?auth）',       input: 'feature/add?auth',       expected: false },
  { name: '特殊文字: アスタリスク（feature/add*auth）',       input: 'feature/add*auth',       expected: false },
  // 連続ドット・先頭末尾
  { name: '連続するドット: feature/add..auth',                input: 'feature/add..auth',      expected: false },
  { name: '先頭がドット: .feature/test',                      input: '.feature/test',          expected: false },
  { name: '末尾がハイフン: feature/test-',                    input: 'feature/test-',          expected: false },
  // 語数バリデーション（プレフィックス後の語数チェック）
  { name: 'プレフィックス後1語のみ: feature/auth',            input: 'feature/auth',           expected: false },
  { name: 'プレフィックス後1語のみ: bugfix/login',            input: 'bugfix/login',           expected: false },
  { name: 'プレフィックス後1語のみ: chore/deps',              input: 'chore/deps',             expected: false },
  { name: 'プレフィックス後2語以上: feature/add-auth',        input: 'feature/add-auth',       expected: true  },
  { name: 'プレフィックス後3語以上: bugfix/fix-login-error',  input: 'bugfix/fix-login-error', expected: true  },
  { name: 'プレフィックス後2語以上: chore/update-deps',       input: 'chore/update-deps',      expected: true  },
];

describe('isValidBranchName', () => {
  test.each(isValidBranchNameCases)('$name → $expected', ({ input, expected }) => {
    expect(isValidBranchName(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// extractBranchName
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// generateFallbackBranchName
// ---------------------------------------------------------------------------

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
