/**
 * Tests for verify-self-repair's feedback-block helpers and the
 * attemptVerifyRepair repair-budget double-check (task 749).
 *
 * The feedback-block describes cover the pure functions behind
 * writeRepairFeedback: reason sanitisation (no numeric failure tallies
 * survive), marker wrapping, and replace-not-stack merging — the trio that
 * stops a past rejection from poisoning the next validateVerify cycle
 * (task 494's repair loop).
 *
 * mock.module is registered below BEFORE verify-self-repair is imported
 * (via a top-level dynamic import, same pattern as verify-self-repair.cas.test.ts)
 * so the pure-function tests and the new attemptVerifyRepair tests can share
 * one file without a static import loading the real prisma client first.
 */

import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { validateVerify } from './phase-output-validator';

const noopLogger = { info: () => {}, warn: mock(() => {}), error: () => {}, debug: () => {} };

const mockPrisma = {
  userSettings: { findFirst: mock(() => Promise.resolve(null)) },
  activityLog: { findFirst: mock(() => Promise.resolve(null)) },
  workflowTransition: {
    count: mock(() => Promise.resolve(0)),
    findFirst: mock(() => Promise.resolve(null)),
    findMany: mock(() => Promise.resolve([] as { metadata: string | null }[])),
  },
  task: {
    updateMany: mock(() => Promise.resolve({ count: 1 })),
    findFirst: mock(() => Promise.resolve(null)),
    findUnique: mock(() => Promise.resolve(null)),
  },
  workflowFile: { findFirst: mock(() => Promise.resolve(null)) },
};
const readWorkflowFile = mock(() => Promise.resolve(''));
const writeWorkflowFile = mock(() => Promise.resolve());
const recordTransition = mock(() => Promise.resolve());

mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('./workflow-file-utils', () => ({ readWorkflowFile, writeWorkflowFile }));
mock.module('./transition-recorder', () => ({ recordTransition }));
mock.module('./auto-run/theme-auto-run-service', () => ({
  isThemeAutoRunActive: () => Promise.resolve(true),
}));
mock.module('./blocked-task-escalation', () => ({
  escalateBlockedTask: mock(() => Promise.resolve(true)),
  BLOCKED_ESCALATED_CAUSE: 'blocked_escalated',
  countEscalatedBlocked: () => Promise.resolve(0),
}));

const {
  sanitizeRepairReason,
  buildRepairFeedbackBlock,
  mergeRepairFeedback,
  REPAIR_FEEDBACK_START,
  REPAIR_FEEDBACK_END,
  attemptVerifyRepair,
} = await import('./verify-self-repair');

describe('sanitizeRepairReason', () => {
  test.each([
    'failure signals (1 failed | Tests 3 failed)',
    'verify.md self-contradicts: body contains failure signals (失敗テスト数: 3)',
    'テストが2件失敗しています',
    '失敗 ×4 が検出されました',
  ])('removes numeric failure tallies from %j', (reason) => {
    const sanitized = sanitizeRepairReason(reason);
    expect(sanitized).toContain('テスト失敗あり');
    expect(/\d+\s+failed/i.test(sanitized)).toBe(false);
    expect(/失敗\s*(?:した)?テスト\s*(?:数|件数)?\s*[:：]?\s*\d/.test(sanitized)).toBe(false);
    expect(/[×x]\s*\d/.test(sanitized)).toBe(false);
  });

  test('leaves non-count text untouched', () => {
    const reason = 'verify.md explicitly marks the verification as failed.';
    expect(sanitizeRepairReason(reason)).toBe(reason);
  });
});

describe('buildRepairFeedbackBlock', () => {
  test('wraps the block in start/end markers with a one-paragraph summary', () => {
    const block = buildRepairFeedbackBlock('claims all tests pass (Tests 3 failed)', 2);
    expect(block.startsWith(REPAIR_FEEDBACK_START)).toBe(true);
    expect(block.endsWith(REPAIR_FEEDBACK_END)).toBe(true);
    expect(block).toContain('自己修復 2 回目');
    // The sanitized reason must not re-introduce a scannable count.
    expect(/\d+\s+failed/i.test(block)).toBe(false);
  });

  // Task 727 ケース5a: verifyContent から失敗テストの file:line だけでなく、
  // 次行以降のメソッド名・エラーメッセージも抽出して含める（file:line 単独行の
  // 直後にテスト名・Error 行が続くランナー出力形式を想定）。
  test('verifyContent から失敗テストの file:line・メソッド名・エラーメッセージを抽出して含めること', () => {
    const verifyContent = [
      '## テスト結果',
      'FAIL services/workflow/__tests__/verify-self-repair.test.ts:418',
      '  identifyNonConvergence should cutoff after 2 identical causes',
      '  Error: expected true to equal false',
    ].join('\n');
    const block = buildRepairFeedbackBlock('自己矛盾を検出', 1, verifyContent);
    expect(block).toMatch(/Failed test:.*\.(test|spec)\.ts:\d+/);
    expect(block).toContain('services/workflow/__tests__/verify-self-repair.test.ts:418');
    expect(block).toContain('identifyNonConvergence should cutoff after 2 identical causes');
    expect(block).toContain('Error: expected true to equal false');
  });

  // Task 727 ケース5b: 抽出した周辺テキストからも数値集計は除去され、file:line は保持される。
  test('抽出した失敗詳細から数値集計は除去され、file:line は保持されること', () => {
    const verifyContent = 'services/foo.test.ts:99 — 3 failed while running the suite';
    const block = buildRepairFeedbackBlock('reason', 1, verifyContent);
    expect(/\d+\s+failed/i.test(block)).toBe(false);
    expect(block).toContain('services/foo.test.ts:99');
  });

  test('verifyContent が無ければ従来通り失敗詳細行を含めないこと', () => {
    const block = buildRepairFeedbackBlock('reason', 1);
    expect(block).not.toContain('Failed test:');
  });
});

describe('mergeRepairFeedback', () => {
  const passingVerify = `# 検証レポート
## 検証結果サマリ
✅ 検証成功 — 12/12 passed
## テスト結果
bun test: 12 passed, 0 failed
## チェックリスト消化状況
- [x] done`;

  test('appends the block after the existing verify content', () => {
    const merged = mergeRepairFeedback(passingVerify, buildRepairFeedbackBlock('reason', 1));
    expect(merged.startsWith('# 検証レポート')).toBe(true);
    expect(merged).toContain(REPAIR_FEEDBACK_START);
  });

  test('replaces (does not stack) a previous feedback block', () => {
    const first = mergeRepairFeedback(passingVerify, buildRepairFeedbackBlock('first', 1));
    const second = mergeRepairFeedback(first, buildRepairFeedbackBlock('second', 2));
    expect(second.match(/repair-feedback:start/g)?.length).toBe(1);
    expect(second).toContain('自己修復 2 回目');
    expect(second).not.toContain('自己修復 1 回目');
  });

  test('uses the block alone when there is no prior content', () => {
    const merged = mergeRepairFeedback('', buildRepairFeedbackBlock('reason', 1));
    expect(merged.startsWith(REPAIR_FEEDBACK_START)).toBe(true);
  });

  test('merged output with a count-bearing reason still passes validateVerify', () => {
    // End-to-end guard: feedback describing "Tests 3 failed" must not make a
    // corrected (passing) verify.md self-contradict on the NEXT validation.
    const merged = mergeRepairFeedback(
      passingVerify,
      buildRepairFeedbackBlock(
        'claims all tests pass while body contains failure signals (1 failed | Tests 3 failed)',
        1,
      ),
    );
    expect(validateVerify(merged).ok).toBe(true);
  });
});

describe('attemptVerifyRepair — 修復予算のダブルチェック (task 749)', () => {
  beforeEach(() => {
    mockPrisma.userSettings.findFirst.mockReset().mockResolvedValue(null);
    mockPrisma.activityLog.findFirst.mockReset().mockResolvedValue(null);
    mockPrisma.workflowTransition.count.mockReset().mockResolvedValue(0);
    mockPrisma.workflowTransition.findMany.mockReset().mockResolvedValue([]);
    mockPrisma.task.updateMany.mockReset().mockResolvedValue({ count: 1 });
    mockPrisma.task.findUnique.mockReset().mockResolvedValue(null);
    mockPrisma.workflowFile.findFirst.mockReset().mockResolvedValue(null);
    readWorkflowFile.mockReset().mockResolvedValue('');
    writeWorkflowFile.mockReset().mockResolvedValue(undefined);
    recordTransition.mockReset().mockResolvedValue(undefined);
  });

  // 既定 verifyRepairLimit=2 の境界値: prior=0/1 は再チェックを通過してbounceする。
  test.each([0, 1])(
    '既定上限2で prior=%i なら再チェック後も bounce する（attempt = prior+1）',
    async (prior) => {
      mockPrisma.workflowTransition.count.mockResolvedValue(prior);
      const result = await attemptVerifyRepair(700, 'research_done', 'reason', 'verify body');
      expect(result.bounced).toBe(true);
      expect(result.attempt).toBe(prior + 1);
      expect(recordTransition).toHaveBeenCalledTimes(1);
    },
  );

  test('既定上限2で prior=2 は初回チェックで遮断され recordTransition は呼ばれない', async () => {
    mockPrisma.workflowTransition.count.mockResolvedValue(2);
    const result = await attemptVerifyRepair(700, 'research_done', 'reason', 'verify body');
    expect(result.bounced).toBe(false);
    expect(recordTransition).not.toHaveBeenCalled();
  });

  // task#603/#710 の再現: 初回読み取り(prior=1)は予算内だが、コミット直前の再クエリでは
  // 別の呼び出し経路が同時に verify_repair を記録済みで prior=2（max=2）に達している。
  test('二重呼び出し: 初回読み取り後に別経路が予算を使い切っていれば再チェックで遮断する', async () => {
    mockPrisma.workflowTransition.count.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const result = await attemptVerifyRepair(700, 'research_done', 'reason', 'verify body');
    expect(result.bounced).toBe(false);
    expect(recordTransition).not.toHaveBeenCalled();
    // 再チェック失敗時は状態を一切変更しない(CASもフィードバック書込も行わない)。
    expect(mockPrisma.task.updateMany).not.toHaveBeenCalled();
    expect(writeWorkflowFile).not.toHaveBeenCalled();
  });
});
