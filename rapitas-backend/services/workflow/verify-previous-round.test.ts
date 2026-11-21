/**
 * verify-previous-round.test
 *
 * 2026-11-21: trendline task 521's verifier changed model every round
 * (gpt-6.1-sol, claude-opus-5-5, gpt-6-astra) and each round judged from
 * scratch, with neither the previous verify.md nor the previous rejection in
 * its context. A different model could re-judge an item that had already
 * passed, or miss what the last round sent back.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

let previousVerify: string | null = null;
let lastRepair: { metadata: string } | null = null;
mock.module('./workflow-file-utils', () => ({
  readWorkflowFile: async (_id: number, type: string) =>
    type === 'verify' ? previousVerify : null,
}));
mock.module('../../config/database', () => ({
  prisma: { workflowTransition: { findFirst: async () => lastRepair } },
}));

const { buildPreviousRoundSection } = await import('./verify-previous-round');

const PREVIOUS = `# 検証レポート

**⚠️ 一部失敗**

## 受入条件との対応
| 条件 | 状態 | 根拠 |
| --- | --- | --- |
| 1 保存と復元 | ✅ 完了 | service_test.go で一致 |
| 2 共有リンク | ❌ 未達 | 失効リンクが 200 を返す |
| 3 経過日数 | ✅ 完了 | 30/90/180 日の境界テスト |

<!-- repair-feedback:start -->
前回の差し戻し: 古い指摘
<!-- repair-feedback:end -->
`;

beforeEach(() => {
  previousVerify = null;
  lastRepair = null;
});

describe('buildPreviousRoundSection', () => {
  test('is empty on the first round', async () => {
    expect(await buildPreviousRoundSection(521, 'ja')).toBe('');
  });

  test('carries the open items, the passed items and the last rejection', async () => {
    previousVerify = PREVIOUS;
    lastRepair = {
      metadata: JSON.stringify({ reason: '差分レビュー不合格: 受入基準2: 失効リンクが閲覧できる' }),
    };
    const s = await buildPreviousRoundSection(521, 'ja');
    expect(s).toContain('失効リンクが 200 を返す');
    expect(s).toContain('service_test.go で一致');
    expect(s).toContain('受入基準2: 失効リンクが閲覧できる');
    // The rule: open items first, carried items only when the diff left them alone.
    expect(s).toContain('最初に');
    expect(s).toContain('前回判定を引継ぎ');
    expect(s).toContain('毎回取り直す');
  });

  test('never carries the repair-feedback block of the old report', async () => {
    previousVerify = PREVIOUS;
    expect(await buildPreviousRoundSection(521, 'ja')).not.toContain('古い指摘');
  });

  test('keeps a passed row out of the open list', async () => {
    previousVerify = PREVIOUS;
    const s = await buildPreviousRoundSection(521, 'ja');
    const open = s.slice(s.indexOf('未達'), s.indexOf('合格した項目'));
    expect(open).not.toContain('service_test.go');
  });
});
