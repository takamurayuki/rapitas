/**
 * review-hold-publish.verifier-eligibility テスト
 *
 * 人間が保留を上書きした後の公開・完了（publishAfterReviewOverride）も、共通の
 * 完了チェックを通ることを固定する。陪審の争点の上書きは検証役の判定を省く
 * 理由にならない（保留の時点で検証役は判定されていないことがある）。
 * 不適格な検証役の上書きは、束縛（verify.md の sha256・worktree・git tree）が
 * 一致する間だけ有効。実物の共通チェック・verifier-eligibility を通す。
 */
import { beforeEach, expect, mock, test } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('./transition-recorder', () => ({ recordTransition: async () => undefined }));
mock.module('./blocked-task-write', () => ({ writeBlockedTask: async () => undefined }));
mock.module('./workflow-cli-executor-helpers', () => ({ taskHasLinkedPr: async () => true }));
mock.module('./required-merge-hold', () => ({ holdForRequiredMerge: async () => true }));
mock.module('./verify-settle-artifact-recovery', () => ({
  isAwaitingRequiredMerge: async () => false,
  isAwaitingStagedPrCompletion: async () => false,
}));
const { isNoChangeCompletion } =
  await import('../../routes/workflow/workflow-auto-commit-classify');
const performAutoCommitAndPR = mock(async (..._a: unknown[]) => {
  published = true;
  return {
    requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
    autoCommitResult: { success: true, filesChanged: 1 },
    autoPRResult: { success: true },
  };
});
mock.module('../../routes/workflow/workflow-auto-commit', () => ({
  performAutoCommitAndPR,
  isNoChangeCompletion,
}));
mock.module('./verify-jury-completion', () => ({ readVerifySha256: async () => 'sha-5' }));
mock.module('../agents/verification/review-diff-fingerprint', () => ({
  currentDiffFingerprint: async () => 'fp-5',
}));
mock.module('../../routes/workflow/workflow-auto-commit-binding', () => ({
  resolvePublishWorktree: async () => '/wt/5',
  publishBindingDrift: async () => null,
  checkBindingBeforeCommit: async () => ({ drift: null, stable: 'tree-5' }),
  bindingDriftAfterCommit: async () => null,
}));
let treeAfterPublish = 'tree-5';
let published = false;
mock.module('../../routes/workflow/workflow-auto-commit-tree-identity', () => ({
  stagedTreeIdentity: async () => (published ? treeAfterPublish : 'tree-5'),
  committedTreeIdentity: async () => 'tree-5',
}));
const holdForHumanReview = mock(
  async (_p: Record<string, unknown>): Promise<'held' | 'cas_lost'> => 'held',
);
mock.module('./review-hold', () => ({
  REVIEW_HOLD_CAUSE: 'adversarial_review_awaiting_human',
  REVIEW_HOLD_RESOLVED_CAUSE: 'adversarial_review_hold_resolved',
  readReviewHold: async () => null,
  holdForHumanReview,
}));

let verifierModel: string | null = null;
let resolvedMeta: Record<string, unknown> = {};
const verifierLookup = mock(async () => ({
  modelName: verifierModel,
  status: 'completed',
  session: { mode: 'workflow-verifier' },
}));
const updateMany = mock(async (_a: unknown) => ({ count: 1 }));
mock.module('../../config/database', () => ({
  prisma: {
    task: { updateMany },
    agentExecution: {
      findFirst: verifierLookup,
      findMany: async () => [{ modelName: 'claude-sonnet-5-5' }],
    },
    workflowTransition: {
      findFirst: async () => ({
        cause: 'adversarial_review_hold_resolved',
        metadata: resolvedMeta,
      }),
    },
  },
}));

const { publishAfterReviewOverride } = await import('./review-hold-publish');

const BINDING = { verifySha256: 'sha-5', diffFingerprint: 'fp-5', worktreePath: '/wt/5' };
const publish = (reason: 'unresolved_dispute' | 'ineligible_verifier') =>
  publishAfterReviewOverride(5, '# verify', {
    binding: BINDING,
    hold: { reason, detail: '', findings: [] },
  });

beforeEach(() => {
  verifierModel = null;
  resolvedMeta = { action: 'override', holdReason: 'unresolved_dispute' };
  treeAfterPublish = 'tree-5';
  published = false;
  verifierLookup.mockClear();
  updateMany.mockClear();
  performAutoCommitAndPR.mockClear();
  holdForHumanReview.mockClear();
});

test('陪審の争点の上書き＋検証役の実モデル未報告 → 公開も完了もせず、検証役で保留する', async () => {
  expect(await publish('unresolved_dispute')).toBe('verifier_unconfirmed');
  expect(verifierLookup).toHaveBeenCalledTimes(1);
  expect(performAutoCommitAndPR).not.toHaveBeenCalled();
  expect(updateMany).not.toHaveBeenCalled();
  expect(holdForHumanReview.mock.calls[0]?.[0]).toMatchObject({
    reason: 'ineligible_verifier',
    source: 'override_publish',
  });
});

test('陪審の争点の上書き＋検証役が適格 → 従来どおり公開して完了する', async () => {
  verifierModel = 'claude-opus-5-5';
  expect(await publish('unresolved_dispute')).toBe('completed');
  expect(performAutoCommitAndPR).toHaveBeenCalledTimes(1);
  expect(updateMany).toHaveBeenCalledTimes(1);
});

test('不適格な検証役の上書きで束縛が一致 → 再判定せず公開して完了する', async () => {
  resolvedMeta = {
    action: 'override',
    holdReason: 'ineligible_verifier',
    binding: { verifySha256: 'sha-5', treeId: 'tree-5', worktreePath: '/wt/5' },
  };
  expect(await publish('ineligible_verifier')).toBe('completed');
  expect(verifierLookup).not.toHaveBeenCalled();
  expect(updateMany).toHaveBeenCalledTimes(1);
});

test('不適格な検証役の上書きでも、束縛の tree が違えば公開も完了もしない', async () => {
  resolvedMeta = {
    action: 'override',
    holdReason: 'ineligible_verifier',
    binding: { verifySha256: 'sha-5', treeId: 'tree-OLD', worktreePath: '/wt/5' },
  };
  expect(await publish('ineligible_verifier')).toBe('verifier_unconfirmed');
  expect(performAutoCommitAndPR).not.toHaveBeenCalled();
  expect(updateMany).not.toHaveBeenCalled();
});

test('公開の途中で差分が変われば、公開後の完了の直前で止める', async () => {
  resolvedMeta = {
    action: 'override',
    holdReason: 'ineligible_verifier',
    binding: { verifySha256: 'sha-5', treeId: 'tree-5', worktreePath: '/wt/5' },
  };
  treeAfterPublish = 'tree-CHANGED';
  expect(await publish('ineligible_verifier')).toBe('verifier_unconfirmed');
  expect(performAutoCommitAndPR).toHaveBeenCalledTimes(1);
  expect(updateMany).not.toHaveBeenCalled();
});
