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

  // 2026-11-24: TempoRaid task 1347's passing report recorded that pnpm refused
  // the worktree's junctioned node_modules and the verifier ran the same check
  // directly instead. The honesty gate read the row's "exit 1" as a hidden
  // failure and bounced it. A refusal by the environment with the workaround
  // named on the same line is history; a refusal with no workaround is not.
  test.each([
    '| pnpm filter経由のPrisma validate | ジャンクション拒否、exit 1 | CLI直接検査へ切替 |',
    '| pnpm -r test | ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH, exit 1 | パッケージ位置から vitest を直接実行 |',
    '| pnpm --filter server test | junction refused, exit 1 | ran vitest directly instead |',
  ])('treats an environment refusal with a named workaround as history: %s', (line) => {
    expect(isResolvedFailureLine(line)).toBe(true);
  });

  test.each([
    '| pnpm filter経由のテスト | ジャンクション拒否、exit 1 | |',
    '| pnpm -r test | ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH, exit 1 | 直接実行に切替えたが依然として失敗 |',
    '| e2e | exit 1 | 直接実行に切替 |',
  ])('keeps a refusal with no workaround, or a plain failure, detectable: %s', (line) => {
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
