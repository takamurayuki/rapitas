/**
 * subtask-completion-handler.verifier-eligibility テスト
 *
 * 子タスクが全件成功したときに親を完了させる経路（onSubtaskCompleted）が、
 * 親の検証役の適格性・未解決の先送り・現在のレビュー保留を確認せずに親を
 * completed / done にしないことを、実物の共通完了チェック・verifier-eligibility を
 * 通して固定する（G2 routing1 再レビュー4 指摘2）。
 */
import { beforeEach, expect, mock, test } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('../communication/realtime-service', () => ({
  realtimeService: { sendTaskUpdate: () => {}, broadcast: () => {} },
  RealtimeService: class {},
}));
const writeWorkflowFile = mock(async () => undefined);
mock.module('./workflow-file-utils', () => ({ writeWorkflowFile }));
mock.module('./transition-recorder', () => ({ recordTransition: async () => undefined }));
mock.module('../task/task-resolver', () => ({
  resolveTaskSubtaskInfo: async () => ({ parentId: 900 }),
  resolveTaskWithThemeAndCategory: async () => ({
    id: 900,
    title: '親タスク',
    priority: 'high',
    themeId: 1,
    status: 'in-progress',
    workflowStatus: 'in_progress',
    completedAt: null,
  }),
}));
mock.module('./automation-policy', () => ({
  resolveAutomationPolicy: async () => ({
    autoCommit: true,
    autoCreatePR: true,
    autoMergePR: false,
  }),
  resolveLandingMode: () => 'pr',
  isStagedCompletionEnabled: () => false,
}));
mock.module('./verify-settle-artifact-recovery', () => ({
  isAwaitingRequiredMerge: async () => false,
}));
mock.module('./required-merge-hold', () => ({
  holdForRequiredMerge: async () => true,
  AWAITING_REQUIRED_MERGE_CAUSE: 'verify_awaiting_required_merge',
}));
const performAutoCommitAndPR = mock(async () => ({}));
mock.module('../../routes/workflow/workflow-auto-commit', () => ({ performAutoCommitAndPR }));
const holdForHumanReview = mock(
  async (_p: Record<string, unknown>): Promise<'held' | 'cas_lost'> => 'held',
);
let onHold = false;
mock.module('./review-hold', () => ({
  REVIEW_HOLD_CAUSE: 'adversarial_review_awaiting_human',
  REVIEW_HOLD_RESOLVED_CAUSE: 'adversarial_review_hold_resolved',
  readReviewHold: async () =>
    onHold ? { reason: 'ineligible_verifier', detail: '', findings: [] } : null,
  holdForHumanReview,
}));

let verifierModel: string | null = null;
let latestCause = 'file_saved:verify';
const verifierLookup = mock(async () => ({
  modelName: verifierModel,
  status: 'completed',
  session: { mode: 'workflow-verifier' },
}));
const taskUpdate = mock(async (_a: unknown) => ({}));
mock.module('../../config/database', () => ({
  prisma: {
    task: {
      findMany: async () => [
        { id: 901, title: 'サブタスクA', status: 'done', workflowStatus: 'completed' },
      ],
      update: taskUpdate,
    },
    agentExecution: {
      findFirst: verifierLookup,
      findMany: async () => [{ modelName: 'claude-sonnet-5-5' }],
    },
    workflowTransition: { findFirst: async () => ({ cause: latestCause, metadata: null }) },
  },
}));

const { onSubtaskCompleted } = await import('./subtask-completion-handler');

/** Whether the parent was written as completed. */
const parentCompleted = () =>
  taskUpdate.mock.calls.some(
    (c) => (c[0] as { data?: { workflowStatus?: string } }).data?.workflowStatus === 'completed',
  );

beforeEach(() => {
  verifierModel = null;
  latestCause = 'file_saved:verify';
  onHold = false;
  verifierLookup.mockClear();
  taskUpdate.mockClear();
  writeWorkflowFile.mockClear();
  performAutoCommitAndPR.mockClear();
  holdForHumanReview.mockClear();
});

test('レビューの再現：子は全件成功・親の検証役の実モデル未報告 → 親を完了しない', async () => {
  await onSubtaskCompleted(901);
  expect(verifierLookup).toHaveBeenCalledTimes(1);
  expect(parentCompleted()).toBe(false);
  expect(performAutoCommitAndPR).not.toHaveBeenCalled();
  expect(holdForHumanReview.mock.calls[0]?.[0]).toMatchObject({
    source: 'subtask_parent',
    fromStatus: 'in_progress',
  });
});

test('親の検証役が不適格（Haiku）なら完了しない', async () => {
  verifierModel = 'claude-haiku-5-5';
  await onSubtaskCompleted(901);
  expect(parentCompleted()).toBe(false);
});

test('親の最新の verify 保存が先送りのままなら完了しない', async () => {
  verifierModel = 'claude-opus-5-5';
  latestCause = 'verifier_eligibility_deferred';
  await onSubtaskCompleted(901);
  expect(parentCompleted()).toBe(false);
});

test('親がレビュー保留中なら完了せず、統合 verify.md も書き換えない', async () => {
  verifierModel = 'claude-opus-5-5';
  onHold = true;
  await onSubtaskCompleted(901);
  expect(parentCompleted()).toBe(false);
  expect(writeWorkflowFile).not.toHaveBeenCalled();
});

test('親の検証役が適格（または検証役の実行がない）なら、従来どおり完了する', async () => {
  verifierModel = 'claude-opus-5-5';
  await onSubtaskCompleted(901);
  expect(verifierLookup).toHaveBeenCalledTimes(1);
  expect(parentCompleted()).toBe(true);
  expect(performAutoCommitAndPR).toHaveBeenCalledTimes(1);
});
