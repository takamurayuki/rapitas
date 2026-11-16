/**
 * verify-completion-gate.verifier-eligibility テスト
 *
 * HTTP の verify.md 保存経路で、レビュー不適格なモデルが出した verify の判定を完了
 * ゲートが適格な検証として扱わない（陪審・commit/PR へ進めず、人間の判断待ちに
 * する）ことを、実物の verifier-eligibility を通して固定する。
 *
 * G2 routing1 再レビュー指摘5・4・3:
 *  - 実行中で実モデルが未報告なら、起動時の指定が適格でも完了を先送りする
 *    （陪審は走らせてよいが、commit/PR へは進めない）。
 *  - 記録が読めなければ止める。
 *  - 競合解消タスク（既存 PR あり）でも判定を通す。
 */
import { beforeEach, expect, mock, test } from 'bun:test';

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}));
let taskRow: { title: string; githubPrId: number | null } = {
  title: 'Implement requirement',
  githubPrId: null,
};
mock.module('../../../../config', () => ({
  prisma: {
    task: { findUnique: async () => taskRow },
    agentSession: { findFirst: async () => ({ worktreePath: '/task' }) },
  },
}));
let verifierModel: string | null = 'claude-opus-5-5';
let verifierStatus = 'completed';
let implementerModel = 'claude-opus-5-5';
let dbDown = false;
mock.module('../../../../config/database', () => ({
  prisma: {
    agentExecution: {
      findFirst: async () => {
        if (dbDown) throw new Error('db down');
        return {
          modelName: verifierModel,
          status: verifierStatus,
          session: { mode: 'workflow-verifier' },
        };
      },
      findMany: async () => [{ modelName: implementerModel }],
    },
    // The launch plan says Opus; it must never stand in for the reported model.
    workflowRoleConfig: { findFirst: async () => ({ modelId: 'claude-opus-5-5' }) },
  },
}));
mock.module('../../../../services/memory/timeline', () => ({
  queryEvents: async () => ({ events: [], total: 0 }),
}));
mock.module('../../../../services/workflow/completion-gate', () => ({
  evaluateCompletionGate: async () => ({ allow: true, reason: 'has_changes' }),
}));
mock.module('../../../../services/task/task-resolver', () => ({
  resolvePreferredBaseBranch: async () => 'develop',
}));
const holdForHumanReview = mock(async (_p: Record<string, unknown>) => 'held' as const);
mock.module('../../../../services/workflow/review-hold', () => ({ holdForHumanReview }));
const recordTransition = mock(async (_p: Record<string, unknown>) => undefined);
mock.module('../../../../services/workflow/transition-recorder', () => ({ recordTransition }));

const { runVerifyCompletionGate } = await import('./verify-completion-gate');

const params = {
  taskId: 910,
  fileType: 'verify' as const,
  newStatus: 'verify_done',
  savedContent: 'PASS',
};

beforeEach(() => {
  holdForHumanReview.mockClear();
  recordTransition.mockClear();
  verifierModel = 'claude-opus-5-5';
  verifierStatus = 'completed';
  implementerModel = 'claude-opus-5-5';
  dbDown = false;
  taskRow = { title: 'Implement requirement', githubPrId: null };
});

test('premium の実装を standard が検証した判定は、完了ゲートで止めて人間に回す', async () => {
  verifierModel = 'claude-sonnet-5-5';
  const out = await runVerifyCompletionGate(params);
  expect(out.verifyGateBlocked).toBe(true);
  expect(holdForHumanReview).toHaveBeenCalledTimes(1);
  expect(holdForHumanReview.mock.calls[0][0].reason).toBe('ineligible_verifier');
});

test('ティア表でレビュー不可（Haiku）の判定も止める', async () => {
  implementerModel = 'claude-sonnet-5-5';
  verifierModel = 'claude-haiku-5-5';
  expect((await runVerifyCompletionGate(params)).verifyGateBlocked).toBe(true);
});

test('適格な検証役（Opus が Opus の実装を検証）なら先へ進める', async () => {
  const out = await runVerifyCompletionGate(params);
  expect(out.verifyGateBlocked).toBe(false);
  expect(holdForHumanReview).not.toHaveBeenCalled();
});

test('実行中で実モデル未報告なら、Opus 設定でも完了を先送りする（陪審は止めない）', async () => {
  verifierModel = null;
  verifierStatus = 'running';
  const out = await runVerifyCompletionGate(params);
  expect(out.completionDeferred).toBe(true);
  expect(out.verifyGateBlocked).toBe(false);
  expect(holdForHumanReview).not.toHaveBeenCalled();
});

test('適格なら先送りしない', async () => {
  expect((await runVerifyCompletionGate(params)).completionDeferred).toBe(false);
});

test('実行記録が読めなければ止める', async () => {
  dbDown = true;
  expect((await runVerifyCompletionGate(params)).verifyGateBlocked).toBe(true);
});

test('競合解消タスク（既存 PR あり）でも適格性判定を通す', async () => {
  taskRow = { title: 'PR #12 の競合を解消', githubPrId: 12 };
  verifierModel = 'claude-haiku-5-5';
  const out = await runVerifyCompletionGate(params);
  expect(out.isConflictResolutionTask).toBe(true);
  expect(out.verifyGateBlocked).toBe(true);
  expect(holdForHumanReview).toHaveBeenCalledTimes(1);
});
