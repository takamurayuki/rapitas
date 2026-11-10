/**
 * verifier-completion-check テスト
 *
 * 共通の完了チェックで、人間の override（不適格な検証役の保留の上書き）が
 * 有効なのは「その override が最新の記録で、今は保留されておらず、override が
 * 束縛した verify.md の sha256・公開 worktree・git tree ID が現在と一致する」
 * ときだけであることを固定する（G2 routing1 再レビュー4 指摘1：override の後に
 * 公開処理が binding 不一致で再保留しても、古い override で 許可=true・
 * 保留読み取り0回・適格性検査0回 だった）。実物の verifier-eligibility を通す。
 */
import { beforeEach, expect, mock, test } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('./transition-recorder', () => ({ recordTransition: async () => undefined }));

const holdForHumanReview = mock(
  async (_p: Record<string, unknown>): Promise<'held' | 'cas_lost'> => 'held',
);
let onHold = false;
const probeReviewHold = mock(async () =>
  onHold
    ? { state: 'held', hold: { reason: 'ineligible_verifier', detail: '', findings: [] } }
    : { state: 'clear' },
);
mock.module('./review-hold', () => ({
  REVIEW_HOLD_CAUSE: 'adversarial_review_awaiting_human',
  REVIEW_HOLD_RESOLVED_CAUSE: 'adversarial_review_hold_resolved',
  readReviewHold: async () => null,
  probeReviewHold,
  holdForHumanReview,
}));

let currentSha: string | null = 'sha-A';
let currentWorktree: string | null = '/wt/1471';
let currentTree: string | null = 'tree-A';
mock.module('./verify-jury-completion', () => ({ readVerifySha256: async () => currentSha }));
mock.module('../../routes/workflow/workflow-auto-commit-binding', () => ({
  resolvePublishWorktree: async () => currentWorktree,
  publishBindingDrift: async () => null,
  checkBindingBeforeCommit: async () => ({ drift: null, stable: 'tree-A' }),
  bindingDriftAfterCommit: async () => null,
}));
const stagedTreeIdentity = mock(async (_cwd: string) => currentTree);
mock.module('../../routes/workflow/workflow-auto-commit-tree-identity', () => ({
  stagedTreeIdentity,
  committedTreeIdentity: async () => currentTree,
}));

let verifierModel: string | null = null;
const verifierLookup = mock(async () => ({
  modelName: verifierModel,
  status: 'completed',
  session: { mode: 'workflow-verifier' },
}));
type Row = { cause: string; metadata: unknown };
let latest: Row | null = null;
// Older history beneath `latest`, newest first — what a narrower search would find instead.
let older: Row[] = [];
const OVERRIDE_BINDING = { verifySha256: 'sha-A', treeId: 'tree-A', worktreePath: '/wt/1471' };
const override = (binding: unknown = OVERRIDE_BINDING): Row => ({
  cause: 'adversarial_review_hold_resolved',
  metadata: { action: 'override', holdReason: 'ineligible_verifier', binding },
});
mock.module('../../config/database', () => ({
  prisma: {
    agentExecution: {
      findFirst: verifierLookup,
      findMany: async () => [{ modelName: 'claude-sonnet-5-5' }],
    },
    workflowTransition: {
      findFirst: async (a: { where?: { cause?: { in?: string[] } } }) => {
        // Newest row among the causes the query asks for, like orderBy createdAt desc.
        const rows = latest ? [latest, ...older] : older;
        return rows.find((r) => a.where?.cause?.in?.includes(r.cause)) ?? null;
      },
    },
  },
}));

const { verifierConfirmedForCompletion } = await import('./verifier-completion-check');

beforeEach(() => {
  verifierModel = null; // the verifier never reported its model → re-judging refuses
  latest = override();
  older = [];
  onHold = false;
  currentSha = 'sha-A';
  currentWorktree = '/wt/1471';
  currentTree = 'tree-A';
  verifierLookup.mockClear();
  probeReviewHold.mockClear();
  stagedTreeIdentity.mockClear();
  holdForHumanReview.mockReset().mockResolvedValue('held');
});

test('レビューの再現：override の後に再保留されていれば、古い override で完了を許さない', async () => {
  onHold = true;
  expect(await verifierConfirmedForCompletion(1471, 'merge_watcher')).toBe(false);
  expect(probeReviewHold).toHaveBeenCalled();
});

test('override の後に保留の作成記録があれば（保留が別経路で外れていても）override を使わない', async () => {
  latest = {
    cause: 'adversarial_review_awaiting_human',
    metadata: { holdReason: 'ineligible_verifier' },
  };
  older = [override()]; // the human's earlier override, still matching the current state
  expect(await verifierConfirmedForCompletion(1471, 'merge_watcher')).toBe(false);
  expect(verifierLookup).toHaveBeenCalledTimes(1);
});

test('override の束縛（sha256・worktree・tree）が現在と一致すれば、再判定せず完了を許す', async () => {
  expect(await verifierConfirmedForCompletion(1471, 'merge_watcher')).toBe(true);
  expect(verifierLookup).not.toHaveBeenCalled();
  expect(holdForHumanReview).not.toHaveBeenCalled();
  expect(stagedTreeIdentity).toHaveBeenCalledWith('/wt/1471');
});

test('override の後に verify.md が変わっていれば、override を使わず再判定する', async () => {
  currentSha = 'sha-B';
  expect(await verifierConfirmedForCompletion(1471, 'merge_watcher')).toBe(false);
  expect(verifierLookup).toHaveBeenCalledTimes(1);
  expect(holdForHumanReview).toHaveBeenCalledTimes(1);
});

test('override の後に差分（git tree）が変わっていれば、override を使わない', async () => {
  currentTree = 'tree-B';
  expect(await verifierConfirmedForCompletion(1471, 'merge_watcher')).toBe(false);
  expect(verifierLookup).toHaveBeenCalledTimes(1);
});

test('公開に使う worktree が override の対象と違えば、override を使わない', async () => {
  currentWorktree = '/wt/other';
  expect(await verifierConfirmedForCompletion(1471, 'merge_watcher')).toBe(false);
});

test('現在の識別子を読めなければ、override を使わない', async () => {
  currentTree = null;
  expect(await verifierConfirmedForCompletion(1471, 'merge_watcher')).toBe(false);
});

test('束縛を持たない override の記録は、有効扱いしない', async () => {
  latest = override(null);
  expect(await verifierConfirmedForCompletion(1471, 'merge_watcher')).toBe(false);
  expect(verifierLookup).toHaveBeenCalledTimes(1);
});

test('束縛が一致しなくても、検証役が適格なら通常どおり完了を許す', async () => {
  currentTree = 'tree-B';
  verifierModel = 'claude-opus-5-5';
  expect(await verifierConfirmedForCompletion(1471, 'merge_watcher')).toBe(true);
});
