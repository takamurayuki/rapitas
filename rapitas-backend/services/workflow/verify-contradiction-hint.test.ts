/**
 * verify-contradiction-hint.test
 *
 * Fixtures are task 1112's own evidence line (2026-09-28): the task that fixes
 * this false positive had to name the token in its changed-files table, the
 * verdict told it to fix the implementation, and it was sent back to change code
 * that was already correct.
 */
import { describe, test, expect } from 'bun:test';
import { contradictionRewordHint } from './verify-contradiction-hint';

const CHANGED_FILE_ROW =
  '❌ «| `rapitas-backend/services/workflow/phase-output-validator.ts` | 変更 | `:389` 相当の❌検証失敗判定を全文一致からblockquote除外付きの行単位スキャンへ置き換え |»';
const REAL_FAILURE = '❌ «- テスト `foo.test.ts` が 3 件失敗している»';

describe('contradictionRewordHint', () => {
  test('根拠が変更ファイル表の行だけなら、コードではなく文言を直すよう伝える', () => {
    const hint = contradictionRewordHint([CHANGED_FILE_ROW]);
    expect(hint).toContain('changed-files table row');
    expect(hint).toContain('do not');
    expect(hint).toContain('```text');
  });

  // The load-bearing half: one genuine failing line means the implementation
  // really must change, so the reword hint must NOT appear.
  test('本物の失敗行が1件でも混ざれば助言は出さない', () => {
    expect(contradictionRewordHint([CHANGED_FILE_ROW, REAL_FAILURE])).toBe('');
    expect(contradictionRewordHint([REAL_FAILURE])).toBe('');
  });

  test('根拠が無ければ空文字', () => {
    expect(contradictionRewordHint([])).toBe('');
  });

  test('ファイルを名指ししない表の行は対象外', () => {
    expect(contradictionRewordHint(['❌ «| 項目 | 判定 | 備考 |»'])).toBe('');
  });

  // The dangerous near-miss: a test-results row also names a file. Without the
  // Kind cell requirement this would be waved through as a wording problem.
  test('ファイルを名指しするテスト結果表の行は助言対象にしない', () => {
    expect(contradictionRewordHint(['❌ «| `foo.test.ts` | ❌ 3 件失敗 |»'])).toBe('');
  });
});
