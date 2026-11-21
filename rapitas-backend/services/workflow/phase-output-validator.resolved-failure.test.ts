/**
 * phase-output-validator.resolved-failure.test
 *
 * Drives validateVerify with the history row that bounced trendline task 1519
 * (2026-11-21): a failure the report itself records as resolved must not read
 * as a self-contradiction, through any of the three failure detectors (the ❌
 * mark, the "exit 1" runner signal, the "N failed" count). A current failure
 * written the same way must still be caught.
 */
import { describe, expect, test } from 'bun:test';
import { validateVerify } from './phase-output-validator';

const report = (row: string) => `# 検証レポート

## 検証結果サマリ
✅ 検証成功。全テスト通過。

## 変更ファイル
| ファイル | 種別 | 変更内容 |
| --- | --- | --- |
| scripts/stop-all.mjs | 変更 | 停止対象を PID ファイルに限定 |

## テスト結果
| カテゴリ | 結果 | 通過 / 全件 | 備考 |
| --- | --- | --- | --- |
| node --test | ✅ | 18/18 | exit 0 |
${row}

## チェックリスト
- ✅ 実装

## 未解決の懸念
なし
`;

describe('validateVerify — failures the report records as resolved', () => {
  test("task 1519's resolved history row is not a self-contradiction", () => {
    const r = validateVerify(
      report('| 補足検証・初回履歴 | ❌ 初回失敗・解消済み | 1/2 | 終了コード1 |'),
    );
    expect(r.ok).toBe(true);
  });

  test('a resolved runner exit is not a failure', () => {
    const r = validateVerify(report('| 初回実行 | 修正済み | 0/1 | exit 1 → 再実行で成功 |'));
    expect(r.ok).toBe(true);
  });

  test('a resolved failing count is not a failure', () => {
    const r = validateVerify(report('| 初回実行 | 2 failed → 修正済み | 16/18 | |'));
    expect(r.ok).toBe(true);
  });

  test('an unresolved ❌ row is still a contradiction', () => {
    const r = validateVerify(report('| 起動確認 | ❌ 失敗 | 0/1 | |'));
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('self-contradicts');
  });

  test('a retry that failed again is still a contradiction', () => {
    const r = validateVerify(report('| node --test | ❌ 1 failed、再実行でも失敗 | 17/18 | |'));
    expect(r.ok).toBe(false);
  });
});
