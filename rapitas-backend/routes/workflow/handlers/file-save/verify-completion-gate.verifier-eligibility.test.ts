/**
 * verify-completion-gate.verifier-eligibility テスト
 *
 * HTTP の verify.md 保存経路で、レビュー不適格なモデルが出した verify の判定を完了
 * ゲートが適格な検証として扱わない（陪審・commit/PR へ進めず、人間の判断待ちに
 * する）ことを、実物の verifier-eligibility を通して固定する。
 */
import { beforeEach, expect, mock, test } from 'bun:test';

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}));
mock.module('../../../../config', () => ({
  prisma: {
    task: { findUnique: async () => ({ title: 'Implement requirement', githubPrId: null }) },
    agentSession: { findFirst: async () => ({ worktreePath: '/task' }) },
  },
}));
let verifierModel: string | null = 'claude-opus-5-5';
let implementerModel = 'claude-opus-5-5';
mock.module('../../../../config/database', () => ({
  prisma: {
    agentExecution: {
      findFirst: async () => ({ modelName: verifierModel, session: { mode: 'workflow-verifier' } }),
      findMany: async () => [{ modelName: implementerModel }],
    },
    workflowRoleConfig: { findFirst: async () => null },
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

const { runVerifyCompletionGate } = await import('./verify-completion-gate');

const params = {
  taskId: 910,
  fileType: 'verify' as const,
  newStatus: 'verify_done',
  savedContent: 'PASS',
};

beforeEach(() => {
  holdForHumanReview.mockClear();
  verifierModel = 'claude-opus-5-5';
  implementerModel = 'claude-opus-5-5';
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
