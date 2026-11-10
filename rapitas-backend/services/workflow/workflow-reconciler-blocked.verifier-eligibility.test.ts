/**
 * workflow-reconciler-blocked.verifier-eligibility テスト
 *
 * blocked タスクを PR の成功証拠で done に是正する経路（correctBlockedByEvidence）が、
 * 検証役の適格性・未解決の先送り・現在のレビュー保留を確認せずに completed に
 * しないことを、実物の共通完了チェック・verifier-eligibility を通して固定する
 * （G2 routing1 再レビュー4 指摘2：成功証拠だけで 検査0回・完了更新1回）。
 */
import { beforeEach, expect, mock, test } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('./transition-recorder', () => ({ recordTransition: async () => undefined }));
mock.module('./blocked-task-evidence', () => ({
  resolveBlockedTaskEvidence: async () => ({ isSuccess: true, source: 'pr', prState: 'OPEN' }),
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
const holdForHumanReview = mock(
  async (_p: Record<string, unknown>): Promise<'held' | 'cas_lost'> => 'cas_lost',
);
let onHold = false;
mock.module('./review-hold', () => ({
  REVIEW_HOLD_CAUSE: 'adversarial_review_awaiting_human',
  REVIEW_HOLD_RESOLVED_CAUSE: 'adversarial_review_hold_resolved',
  REVIEW_HOLD_HALT_REASON: 'awaiting_review_decision',
  readReviewHold: async () =>
    onHold ? { reason: 'unresolved_dispute', detail: '', findings: [] } : null,
  probeReviewHold: async () =>
    onHold
      ? { state: 'held', hold: { reason: 'unresolved_dispute', detail: '', findings: [] } }
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
const taskUpdate = mock(async (_a: unknown) => ({}));
mock.module('../../config/database', () => ({
  prisma: {
    themeAutoRun: { findMany: async () => [{ themeId: 1 }] },
    task: {
      findMany: async () => [
        {
          id: 1471,
          title: 'tier table',
          themeId: 1,
          workflowStatus: 'verify_done',
          completedAt: null,
          updatedAt: new Date(0),
          workingDirectory: null,
          theme: null,
        },
      ],
      update: taskUpdate,
    },
    agentExecution: {
      // Live-execution probe (status filter) → none; verifier lookup (mode filter) → the run.
      findFirst: async (a: { where?: { session?: { mode?: unknown } } }) =>
        a.where?.session?.mode ? verifierLookup() : null,
      findMany: async () => [{ modelName: 'claude-sonnet-5-5' }],
    },
    workflowTransition: { findFirst: async () => ({ cause: latestCause, metadata: null }) },
  },
}));

const { correctBlockedByEvidence } = await import('./workflow-reconciler-blocked');

const NOW = 1_800_000_000_000;

beforeEach(() => {
  verifierModel = null;
  latestCause = 'file_saved:verify';
  onHold = false;
  verifierLookup.mockClear();
  taskUpdate.mockClear();
  holdForHumanReview.mockClear();
});

test('レビューの再現：成功証拠あり・検証役の実モデル未報告 → 完了しない', async () => {
  expect(await correctBlockedByEvidence(NOW)).toBe(0);
  expect(verifierLookup).toHaveBeenCalledTimes(1);
  expect(taskUpdate).not.toHaveBeenCalled();
  expect(holdForHumanReview.mock.calls[0]?.[0].source).toBe('blocked_evidence');
});

test('不適格な検証役（Haiku）なら完了しない', async () => {
  verifierModel = 'claude-haiku-5-5';
  expect(await correctBlockedByEvidence(NOW)).toBe(0);
  expect(taskUpdate).not.toHaveBeenCalled();
});

test('最新の verify 保存が先送りのままなら完了しない', async () => {
  verifierModel = 'claude-opus-5-5';
  latestCause = 'verifier_eligibility_deferred';
  expect(await correctBlockedByEvidence(NOW)).toBe(0);
  expect(taskUpdate).not.toHaveBeenCalled();
});

test('レビュー保留中なら完了しない', async () => {
  verifierModel = 'claude-opus-5-5';
  onHold = true;
  expect(await correctBlockedByEvidence(NOW)).toBe(0);
  expect(taskUpdate).not.toHaveBeenCalled();
});

test('適格と確認できれば、従来どおり成功証拠から done に是正する', async () => {
  verifierModel = 'claude-opus-5-5';
  expect(await correctBlockedByEvidence(NOW)).toBe(1);
  expect(verifierLookup).toHaveBeenCalledTimes(1);
  expect(taskUpdate).toHaveBeenCalledTimes(1);
});
