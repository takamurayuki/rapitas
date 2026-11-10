/**
 * auto-merge-recovery.verifier-eligibility テスト
 *
 * watcher が毎 tick 呼ぶマージ済み PR の回収（recoverMergedTasks）が、検証役の
 * 適格性を確認できないまま verify_done を completed / done にしないことを、
 * 実物の recovery・停止ガード・verifier-eligibility を通して固定する
 * （G2 routing1 再レビュー3：autoMergePR=true・verify_done・検証役の実モデル
 * 未報告・PR は MERGED の条件で、適格性検査 0 回・完了更新 1 回だった）。
 */
import { beforeEach, expect, mock, test } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('node:fs', () => ({ existsSync: () => true }));
mock.module('./automation-policy', () => ({
  resolveAutomationPolicy: async () => ({
    autoCommit: true,
    autoCreatePR: true,
    autoMergePR: true,
  }),
  resolveLandingMode: () => 'merge',
  isStagedCompletionEnabled: () => true,
}));
mock.module('./transition-recorder', () => ({ recordTransition: async () => undefined }));
mock.module('./auto-merge-notify', () => ({ notify: async () => undefined }));
mock.module('../github/pr-link', () => ({ resolveIntegrationId: async () => 3 }));
mock.module('../agents/orchestrator/git-operations/pr/pr-merge-ops', () => ({
  readAuthoritativeMergeState: async () => ({
    number: 1470,
    state: 'MERGED',
    mergedAt: '2026-11-10T06:00:00Z',
    baseRefName: 'develop',
  }),
}));
const holdForHumanReview = mock(
  async (_p: Record<string, unknown>): Promise<'held' | 'cas_lost'> => 'held',
);
let onHold = false;
let transitionDbDown = false;
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

// The override's bound target as it is now (verify.md sha256 / publish worktree / git tree).
let currentTree: string | null = 'tree-A';
mock.module('./verify-jury-completion', () => ({ readVerifySha256: async () => 'sha-A' }));
mock.module('../../routes/workflow/workflow-auto-commit-binding', () => ({
  resolvePublishWorktree: async () => '/wt/1471',
  publishBindingDrift: async () => null,
  checkBindingBeforeCommit: async () => ({ drift: null, stable: 'tree-A' }),
  bindingDriftAfterCommit: async () => null,
}));
mock.module('../../routes/workflow/workflow-auto-commit-tree-identity', () => ({
  stagedTreeIdentity: async () => currentTree,
  committedTreeIdentity: async () => currentTree,
}));
const BINDING = { verifySha256: 'sha-A', treeId: 'tree-A', worktreePath: '/wt/1471' };

type Where = { session?: { mode?: unknown }; cause?: { in?: string[] } };
let verifierModel: string | null = null;
let verifierDbDown = false;
let latestVerifyCause = 'file_saved:verify';
let latestMetadata: Record<string, unknown> | null = null;
// One mock serves the verifier lookup (session.mode filter) and the stop
// guard's latest-execution lookup (no mode filter) — routed by the query.
const verifierLookup = mock(async () => {
  if (verifierDbDown) throw new Error('db down');
  return { modelName: verifierModel, status: 'completed', session: { mode: 'workflow-verifier' } };
});
const agentExecutionFindFirst = mock(async (a: { where?: Where }) =>
  a.where?.session?.mode
    ? verifierLookup()
    : { id: 9, status: 'completed', startedAt: new Date('2026-11-10T05:00:00Z') },
);
const workflowTransitionFindFirst = mock(async (a: { where?: Where }) => {
  if (transitionDbDown && a.where?.cause?.in?.includes('file_saved:verify')) {
    throw new Error('db down');
  }
  return a.where?.cause?.in?.includes('file_saved:verify')
    ? { cause: latestVerifyCause, metadata: latestMetadata }
    : null;
});
const taskUpdateMany = mock(async (_a: unknown) => ({ count: 1 }));
mock.module('../../config/database', () => ({
  prisma: {
    task: {
      findMany: async () => [
        {
          id: 1471,
          title: 'tier table',
          githubPrId: 1470,
          workingDirectory: '/repo',
          theme: { repositoryUrl: 'https://github.com/acme/repo', workingDirectory: '/repo' },
        },
      ],
      findUnique: async () => ({ status: 'in-progress', themeId: null }),
      updateMany: taskUpdateMany,
    },
    gitHubPullRequest: {
      findFirst: async () => ({
        id: 5,
        baseBranch: 'develop',
        linkedTaskId: 1471,
        integration: { ownerName: 'acme', repositoryName: 'repo' },
      }),
      updateMany: async () => ({ count: 1 }),
    },
    agentExecution: {
      findFirst: agentExecutionFindFirst,
      findMany: async () => [{ modelName: 'claude-sonnet-5-5' }],
    },
    workflowTransition: { findFirst: workflowTransitionFindFirst },
    themeAutoRun: { findFirst: async () => null },
  },
}));

const { recoverMergedTasks } = await import('./auto-merge-recovery');

beforeEach(() => {
  verifierModel = 'claude-opus-5-5';
  verifierDbDown = false;
  latestVerifyCause = 'file_saved:verify';
  latestMetadata = null;
  onHold = false;
  transitionDbDown = false;
  currentTree = 'tree-A';
  verifierLookup.mockClear();
  taskUpdateMany.mockClear();
  holdForHumanReview.mockReset().mockResolvedValue('held');
});

test('レビューの再現：検証役の実モデル未報告・PR は MERGED → 完了しない', async () => {
  verifierModel = null;
  expect(await recoverMergedTasks()).toEqual([]);
  expect(verifierLookup).toHaveBeenCalledTimes(1);
  expect(taskUpdateMany).not.toHaveBeenCalled();
  expect(holdForHumanReview).toHaveBeenCalledTimes(1);
  expect(holdForHumanReview.mock.calls[0][0].source).toBe('merge_recovery');
});

test('記録の読み取り失敗＋保留書き込みも失敗 → 完了しない', async () => {
  verifierDbDown = true;
  holdForHumanReview.mockRejectedValue(new Error('hold write failed'));
  expect(await recoverMergedTasks()).toEqual([]);
  expect(taskUpdateMany).not.toHaveBeenCalled();
});

test('不適格な検証役（Haiku）なら完了しない', async () => {
  verifierModel = 'claude-haiku-5-5';
  expect(await recoverMergedTasks()).toEqual([]);
  expect(taskUpdateMany).not.toHaveBeenCalled();
});

test('最新の verify 保存が先送りのまま残っていれば、適格でも完了しない', async () => {
  latestVerifyCause = 'verifier_eligibility_deferred';
  expect(await recoverMergedTasks()).toEqual([]);
  expect(taskUpdateMany).not.toHaveBeenCalled();
});

test('適格と確認できれば、従来どおりマージ済み PR から完了する', async () => {
  expect(await recoverMergedTasks()).toEqual([1471]);
  expect(verifierLookup).toHaveBeenCalledTimes(1);
  expect(taskUpdateMany).toHaveBeenCalledTimes(1);
});

test('既に人間の判断待ちで保留中なら、保留を書き直さず完了もしない', async () => {
  verifierModel = null;
  onHold = true;
  expect(await recoverMergedTasks()).toEqual([]);
  expect(holdForHumanReview).not.toHaveBeenCalled();
  expect(taskUpdateMany).not.toHaveBeenCalled();
});

test('不適格な検証役の保留を人間が上書きした後なら、再保留せず完了する', async () => {
  verifierModel = null;
  latestVerifyCause = 'adversarial_review_hold_resolved';
  latestMetadata = { action: 'override', holdReason: 'ineligible_verifier', binding: BINDING };
  expect(await recoverMergedTasks()).toEqual([1471]);
  expect(holdForHumanReview).not.toHaveBeenCalled();
});

test('override の後に差分（git tree）が変わっていれば、古い override では完了しない', async () => {
  verifierModel = null;
  currentTree = 'tree-B';
  latestVerifyCause = 'adversarial_review_hold_resolved';
  latestMetadata = { action: 'override', holdReason: 'ineligible_verifier', binding: BINDING };
  expect(await recoverMergedTasks()).toEqual([]);
  expect(taskUpdateMany).not.toHaveBeenCalled();
});

test('別理由の保留の上書き（陪審の争点）は、検証役の再判定を省かない', async () => {
  verifierModel = null;
  latestVerifyCause = 'adversarial_review_hold_resolved';
  latestMetadata = { action: 'override', holdReason: 'unresolved_dispute' };
  expect(await recoverMergedTasks()).toEqual([]);
  expect(taskUpdateMany).not.toHaveBeenCalled();
});

test('先送り記録の読み取りで例外が出たら、適格でも完了しない', async () => {
  transitionDbDown = true;
  expect(await recoverMergedTasks()).toEqual([]);
  expect(taskUpdateMany).not.toHaveBeenCalled();
});
