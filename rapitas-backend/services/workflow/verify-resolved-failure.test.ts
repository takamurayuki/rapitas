/**
 * verify-resolved-failure.test
 *
 * 2026-11-21: trendline task 1519's verify.md passed every check but kept the
 * history row 「補足検証・初回履歴 | ❌ 初回失敗・解消済み | 1/2 | 終了コード1」,
 * and the honesty gate bounced it as a self-contradiction. A failure that the
 * same report records as resolved is not a current failure; one that is not
 * resolved must still be caught.
 */
import { describe, expect, test } from 'bun:test';
import { isResolvedFailureLine } from './verify-resolved-failure';

describe('isResolvedFailureLine', () => {
  test.each([
    '| 補足検証・初回履歴 | ❌ 初回失敗・解消済み | 1/2 | 終了コード1 |',
    '| lint | ❌ 初回 2 件 → 修正済み | 0 |',
    '| node --test | ❌ 1 failed（初回）、再実行で成功 | 18/18 |',
    '- 初回は exit 1 だったが、依存を揃えて再実行で通過した',
    '| build | ❌ → ✅ | |',
    '| e2e | ❌ flaky, passed on retry | |',
    '| typecheck | ❌ 3 errors, fixed in this round | |',
  ])('treats a resolved failure as history: %s', (line) => {
    expect(isResolvedFailureLine(line)).toBe(true);
  });

  test.each([
    '| 起動確認 | ❌ 失敗 | 0/1 | exit 1 |',
    '| node --test | ❌ 1 failed、再実行でも失敗 | 17/18 |',
    '| lint | ❌ 2 件（未解消） | |',
    '| build | ❌ 初回失敗、依然として失敗 | |',
    '| e2e | ❌ fixed the flake but still failing | |',
    '| CI | ❌ 初回失敗 | |',
  ])('keeps a current failure detectable: %s', (line) => {
    expect(isResolvedFailureLine(line)).toBe(false);
  });
});

describe('collectNonpassingRows', () => {
  test('does not quote a resolved row as an open finding', async () => {
    const { collectNonpassingRows } = await import('./verify-scan-text');
    const rows = collectNonpassingRows(
      ['| 補足検証・初回履歴 | ❌ 初回失敗・解消済み | 1/2 |', '| 起動確認 | ❌ 失敗 | 0/1 |'].join(
        '\n',
      ),
    );
    expect(rows).toEqual(['| 起動確認 | ❌ 失敗 | 0/1 |']);
  });
});
