/**
 * blocked-pr-retry-recovery.verifier-eligibility テスト
 *
 * PR 作成失敗で blocked になったタスクの軽量回復（attemptPrOnlyRecovery）が、
 * 検証役の適格性を確認できないまま verify_done を completed / done にしない
 * ことを、実物の共通完了チェック・verifier-eligibility を通して固定する
 * （G2 routing1 再レビュー4 指摘2：既存 PR あり・必須マージなしで、
 * 検査0回・完了更新1回。PR 作成後の完了更新にも同じ穴があった）。
 */
import { beforeEach, expect, mock, test } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('./transition-recorder', () => ({ recordTransition: async () => undefined }));
mock.module('./workflow-file-utils', () => ({ readWorkflowFile: async () => '# verify' }));
let linkedPr = true;
mock.module('./workflow-cli-executor-helpers', () => ({ taskHasLinkedPr: async () => linkedPr }));
const performAutoCommitAndPR = mock(async () => ({
  autoCommitResult: { success: true },
  autoPRResult: { success: true, prUrl: 'https://example.com/pr/1', prNumber: 1 },
}));
mock.module('../../routes/workflow/workflow-auto-commit', () => ({ performAutoCommitAndPR }));
mock.module('./verify-settle-artifact-recovery', () => ({
  isAwaitingRequiredMerge: async () => false,
}));
mock.module('./required-merge-hold', () => ({
  holdForRequiredMerge: async () => true,
  AWAITING_REQUIRED_MERGE_CAUSE: 'verify_awaiting_required_merge',
}));
mock.module('./publication-cancellation-guard', () => ({
  isLatestExecutionCancelled: async () => false,
}));
const holdForHumanReview = mock(
  async (_p: Record<string, unknown>): Promise<'held' | 'cas_lost'> => 'cas_lost',
);
let onHold = false;
mock.module('./review-hold', () => ({
  REVIEW_HOLD_CAUSE: 'adversarial_review_awaiting_human',
  REVIEW_HOLD_RESOLVED_CAUSE: 'adversarial_review_hold_resolved',
  readReviewHold: async () =>
    onHold ? { reason: 'ineligible_verifier', detail: '', findings: [] } : null,
  probeReviewHold: async () =>
    onHold
      ? { state: 'held', hold: { reason: 'ineligible_verifier', detail: '', findings: [] } }
      : { state: 'clear' },
  holdForHumanReview,
}));

let verifierModel: string | null = null;
let latestCause = 'file_saved:verify';
const verifierLookup = mock(async () => ({
  modelName: verifierModel,
  status: 'completed',
  session: { mode: 'workflow-verifier' },
}));
const taskUpdateMany = mock(async (_a: unknown) => ({ count: 1 }));
mock.module('../../config/database', () => ({
  prisma: {
    task: {
      updateMany: taskUpdateMany,
      findUnique: async () => ({ status: 'blocked', themeId: null }),
    },
    themeAutoRun: { findFirst: async () => null },
    agentExecution: {
      findFirst: verifierLookup,
      findMany: async () => [{ modelName: 'claude-sonnet-5-5' }],
    },
    workflowTransition: { findFirst: async () => ({ cause: latestCause, metadata: null }) },
  },
}));

const { attemptPrOnlyRecovery } = await import('./blocked-pr-retry-recovery');

beforeEach(() => {
  verifierModel = null;
  latestCause = 'file_saved:verify';
  linkedPr = true;
  onHold = false;
  verifierLookup.mockClear();
  taskUpdateMany.mockClear();
  performAutoCommitAndPR.mockClear();
  holdForHumanReview.mockClear();
});

test('レビューの再現：既存 PR あり・必須マージなし・検証役の実モデル未報告 → 完了しない', async () => {
  expect(await attemptPrOnlyRecovery(1471)).toBe('verifier_unconfirmed');
  expect(verifierLookup).toHaveBeenCalledTimes(1);
  expect(taskUpdateMany).not.toHaveBeenCalled();
  expect(holdForHumanReview.mock.calls[0]?.[0].source).toBe('blocked_pr_retry');
});

test('PR を作り直す経路でも、確認できなければ PR を作らず完了もしない', async () => {
  linkedPr = false;
  expect(await attemptPrOnlyRecovery(1471)).toBe('verifier_unconfirmed');
  expect(performAutoCommitAndPR).not.toHaveBeenCalled();
  expect(taskUpdateMany).not.toHaveBeenCalled();
});

test('不適格な検証役（Haiku）なら完了しない', async () => {
  verifierModel = 'claude-haiku-5-5';
  expect(await attemptPrOnlyRecovery(1471)).toBe('verifier_unconfirmed');
  expect(taskUpdateMany).not.toHaveBeenCalled();
});

test('最新の verify 保存が先送りのままなら完了しない', async () => {
  verifierModel = 'claude-opus-5-5';
  latestCause = 'verifier_eligibility_deferred';
  expect(await attemptPrOnlyRecovery(1471)).toBe('verifier_unconfirmed');
  expect(taskUpdateMany).not.toHaveBeenCalled();
});

test('人間の判断待ちで保留中なら完了しない', async () => {
  verifierModel = 'claude-opus-5-5';
  onHold = true;
  expect(await attemptPrOnlyRecovery(1471)).toBe('verifier_unconfirmed');
  expect(taskUpdateMany).not.toHaveBeenCalled();
});

test('適格と確認できれば、既存 PR から従来どおり完了する', async () => {
  verifierModel = 'claude-opus-5-5';
  expect(await attemptPrOnlyRecovery(1471)).toBe('completed');
  expect(verifierLookup).toHaveBeenCalledTimes(1);
  expect(taskUpdateMany).toHaveBeenCalledTimes(1);
});

test('適格と確認できれば、PR を作り直して完了する', async () => {
  verifierModel = 'claude-opus-5-5';
  linkedPr = false;
  expect(await attemptPrOnlyRecovery(1471)).toBe('completed');
  expect(performAutoCommitAndPR).toHaveBeenCalledTimes(1);
  expect(taskUpdateMany).toHaveBeenCalledTimes(1);
});
