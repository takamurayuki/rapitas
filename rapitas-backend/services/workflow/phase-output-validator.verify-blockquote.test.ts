/**
 * phase-output-validator.verify-blockquote.test
 *
 * Pins validateVerify's explicit-failure-verdict scan: a blockquote note or a
 * changed-files table cell that merely NAMES a failed verdict is not a failure.
 */
import { expect, test } from 'bun:test';
import { validateVerify } from './phase-output-validator';

const report = (body: string) => `# 検証レポート
## 検証結果サマリ
${body}
## テスト結果
107 pass / 0 fail
## チェックリスト
- ✅ 全項目完了`;

test('a blockquote note describing a PAST failed verdict is not a failure signal (task #1110)', () => {
  const content = report(
    '✅ 検証成功。107/107テスト成功、7/7完了。\n' +
      '> 前回の検証（差分0件）は❌検証失敗としていたが、実装フェーズが対応済みのため本検証で判定を更新する。',
  );
  expect(validateVerify(content).ok).toBe(true);
});

test('a changed-files table row that names a failed verdict in its description is not a failure signal', () => {
  const content = report(
    '✅ 検証成功。107/107テスト成功、7/7完了。\n\n' +
      '| ファイル | 種別 | 変更内容の要約 |\n' +
      '| --- | --- | --- |\n' +
      '| `phase-output-validator.ts` | 変更 | `:389` 相当の❌検証失敗判定を行単位スキャンへ置き換え |\n' +
      '| `phase-output-validator.test.ts` | 新規 | ❌不合格を誤検知する入力の再現テスト |',
  );
  expect(validateVerify(content).ok).toBe(true);
});

test.each([
  ['検証失敗', '❌検証失敗。テスト21/100失敗。'],
  ['不合格', '❌ 不合格。受入基準を満たしていない。'],
  ['不適合', '❌不適合。仕様との差異あり。'],
])('a body-level explicit %s verdict is still detected', (_label, body) => {
  expect(validateVerify(report(body)).ok).toBe(false);
});

test('a test-results table row whose result cell is a failed verdict is still detected', () => {
  const content = report(
    '✅ 検証成功。\n\n' +
      '| テスト項目 | 結果 |\n' +
      '| --- | --- |\n' +
      '| validateVerify | ❌検証失敗 |',
  );
  expect(validateVerify(content).ok).toBe(false);
});
