/**
 * workflow-runner-verify-settle.verifier-eligibility テスト
 *
 * runner の既存 PR 復旧（waitForVerifyCompletion → recoverFromLandedArtifact）
 * が、検証役の適格性を確認できないまま verify_done を completed / done に
 * しないことを、実物の runner・復旧関数・verifier-eligibility を通して固定する
 * （G2 routing1 再レビュー2：既存 PR・保留なし・必須マージなしで、適格性検査
 * 0 回のまま完了に更新された）。
 */
import { beforeEach, expect, mock, test } from 'bun:test';
import type { TaskWorkflowState } from '../task/task-resolver';

process.env.RAPITAS_VERIFY_SETTLE_MS = '30';
process.env.RAPITAS_VERIFY_SETTLE_CAP_MS = '30';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const live: TaskWorkflowState = {
  id: 1471,
  status: 'in-progress',
  workflowStatus: 'verify_done',
  workflowMode: null,
  parentId: null,
};
mock.module('../task/task-resolver', () => ({ resolveTaskWorkflowState: async () => live }));
mock.module('./verify-self-repair', () => ({ hasFreshVerifyRejection: async () => false }));
mock.module('./automation-policy', () => ({
  resolveAutomationPolicy: async () => ({ autoMergePR: false, autoCreatePR: true }),
  resolveLandingMode: () => 'pr',
  isStagedCompletionEnabled: () => false,
}));
mock.module('./transition-recorder', () => ({ recordTransition: async () => undefined }));

// Review hold: none on record, and (the reported case) writing one fails too.
const holdForHumanReview = mock(
  async (_p: Record<string, unknown>): Promise<'held' | 'cas_lost'> => 'held',
);
mock.module('./review-hold', () => ({
  REVIEW_HOLD_RESOLVED_CAUSE: 'adversarial_review_hold_resolved',
  readReviewHold: async () => null,
  holdForHumanReview,
}));

// Task / PR rows read by the recovery: PR #1470 on record, no required merge.
const updateMany = mock(async (_a: unknown) => ({ count: 1 }));
let latestVerifyCause = 'file_saved:verify';
const workflowTransitionFindFirst = mock(async (_a: unknown) => ({ cause: latestVerifyCause }));
mock.module('../../config', () => ({
  prisma: {
    gitHubPullRequest: { findFirst: async () => ({ id: 1470 }) },
    task: { findUnique: async () => ({ githubPrId: 1470 }), updateMany },
  },
}));

// Real verifier-eligibility, fed by these execution records.
let verifierModel: string | null = 'claude-opus-5-5';
let dbDown = false;
const agentExecutionFindFirst = mock(async (_a: unknown) => {
  if (dbDown) throw new Error('db down');
  return { modelName: verifierModel, status: 'completed', session: { mode: 'workflow-verifier' } };
});
mock.module('../../config/database', () => ({
  prisma: {
    agentExecution: {
      findFirst: agentExecutionFindFirst,
      findMany: async () => [{ modelName: 'claude-sonnet-5-5' }],
    },
    workflowTransition: { findFirst: workflowTransitionFindFirst },
  },
}));

const { waitForVerifyCompletion } = await import('./workflow-runner-verify-settle');
const settle = () => waitForVerifyCompletion(1471, new AbortController().signal);

beforeEach(() => {
  verifierModel = 'claude-opus-5-5';
  dbDown = false;
  latestVerifyCause = 'file_saved:verify';
  updateMany.mockClear();
  agentExecutionFindFirst.mockClear();
  holdForHumanReview.mockReset().mockResolvedValue('held');
});

test('レビューの再現：記録の読み取り失敗＋保留書き込みも失敗 → 既存 PR があっても完了しない', async () => {
  dbDown = true;
  holdForHumanReview.mockRejectedValue(new Error('hold write failed'));
  expect(await settle()).toBe('stuck');
  expect(agentExecutionFindFirst).toHaveBeenCalled();
  expect(updateMany).not.toHaveBeenCalled();
});

test('実行後も実モデル未報告なら、既存 PR があっても完了しない', async () => {
  verifierModel = null;
  holdForHumanReview.mockResolvedValue('cas_lost');
  expect(await settle()).toBe('stuck');
  expect(updateMany).not.toHaveBeenCalled();
  expect(holdForHumanReview).toHaveBeenCalledTimes(1);
  expect(holdForHumanReview.mock.calls[0][0].source).toBe('runner_recovery');
});

test('不適格な検証役（Haiku）なら、既存 PR があっても完了しない', async () => {
  verifierModel = 'claude-haiku-5-5';
  expect(await settle()).toBe('stuck');
  expect(updateMany).not.toHaveBeenCalled();
});

test('最新の verify 保存が先送りのまま残っていれば、適格でも完了しない', async () => {
  latestVerifyCause = 'verifier_eligibility_deferred';
  expect(await settle()).toBe('stuck');
  expect(updateMany).not.toHaveBeenCalled();
});

test('適格と確認できれば、従来どおり既存 PR から完了する', async () => {
  expect(await settle()).toBe('completed');
  expect(agentExecutionFindFirst).toHaveBeenCalled();
  expect(updateMany).toHaveBeenCalledTimes(1);
});
