/**
 * verify-repair-unresolved-cutoff テスト
 *
 * detectRepairNonConvergence の第3信号（verify.md 残課題が2周続けて同一）の配線を検証する。
 * 基準・引用証拠が無い状態でも残課題のみで発火すること、変化時・欠落時は発火しないこと。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

let rows: { metadata: string | null }[] = [];
const databaseMock = {
  prisma: {
    task: { findUnique: async () => ({ acceptanceCriteria: null }) },
    workflowTransition: {
      findMany: async () => rows,
      findFirst: async () => null,
    },
    activityLog: { findFirst: async () => null },
    userSettings: { findFirst: async () => null },
  },
};
mock.module('../../config/database', () => databaseMock);

const { detectRepairNonConvergence } =
  await import('../../services/workflow/verify-self-repair-budget');

const verify = (items: string[]) =>
  `# verify\n\n## 残課題\n${items.map((i) => `- ${i}`).join('\n')}\n\n## 使用知識\n- K-1\n`;
const row = (content: string | null) => ({
  metadata: JSON.stringify({
    reason: 'partial verdict',
    ...(content ? { verifyContent: content } : {}),
  }),
});

describe('detectRepairNonConvergence — unchanged 残課題', () => {
  beforeEach(() => {
    rows = [];
  });

  test('cuts off when the previous and current 残課題 are identical, naming the items', async () => {
    rows = [row(verify(['認証基盤未実装', 'RLS 実DB未実施']))];
    const v = await detectRepairNonConvergence(
      1,
      'partial verdict',
      verify(['RLS 実DB未実施', '認証基盤未実装']),
    );
    expect(v.cutoff).toBe(true);
    expect(v.unchangedUnresolved).toContain('認証基盤未実装');
  });

  test('does not cut off when one item changed', async () => {
    rows = [row(verify(['認証基盤未実装', 'RLS 実DB未実施']))];
    const v = await detectRepairNonConvergence(
      1,
      'partial verdict',
      verify(['認証基盤未実装', 'RLS 実DB 一部完了']),
    );
    expect(v.cutoff).toBe(false);
  });

  test('does not cut off when the section is absent or the previous round is missing', async () => {
    rows = [row(verify(['x']))];
    expect(
      (await detectRepairNonConvergence(1, 'partial verdict', '# verify\n- ✅ ok\n')).cutoff,
    ).toBe(false);
    rows = [row(null)];
    expect((await detectRepairNonConvergence(1, 'partial verdict', verify(['x']))).cutoff).toBe(
      false,
    );
  });
});
