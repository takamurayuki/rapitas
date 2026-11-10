/**
 * verifier-completion-check 保留読み取り失敗テスト
 *
 * 共通の完了チェックは「保留なし」と「保留を確認できない」を区別し、後者では
 * 完了を許さないことを固定する（G2 routing1 再レビュー5 指摘1：readReviewHold が
 * DB 例外を「保留なし」の null に変換していたため、束縛が一致する override が
 * あると、現在の保留を読めないまま completionAllowedWhenHoldReadFails=true だった）。
 * 実物の review-hold と verifier-completion-check を通し、保留の読み取りだけを失敗させる。
 */
import { beforeEach, expect, mock, test } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('./transition-recorder', () => ({ recordTransition: async () => undefined }));
mock.module('../memory/timeline', () => ({ appendEvent: async () => undefined }));
mock.module('./verify-jury-completion', () => ({ readVerifySha256: async () => 'sha-A' }));
mock.module('../../routes/workflow/workflow-auto-commit-binding', () => ({
  resolvePublishWorktree: async () => '/wt/1471',
  publishBindingDrift: async () => null,
  checkBindingBeforeCommit: async () => ({ drift: null, stable: 'tree-A' }),
  bindingDriftAfterCommit: async () => null,
}));
mock.module('../../routes/workflow/workflow-auto-commit-tree-identity', () => ({
  stagedTreeIdentity: async () => 'tree-A',
  committedTreeIdentity: async () => 'tree-A',
}));

let holdReadFails = false;
let haltReason: string | null = null;
const OVERRIDE = {
  cause: 'adversarial_review_hold_resolved',
  metadata: {
    action: 'override',
    holdReason: 'ineligible_verifier',
    binding: { verifySha256: 'sha-A', treeId: 'tree-A', worktreePath: '/wt/1471' },
  },
};
const verifierLookup = mock(async () => ({
  modelName: null,
  status: 'completed',
  session: { mode: 'workflow-verifier' },
}));
mock.module('../../config/database', () => ({
  prisma: {
    task: {
      // The hold read: haltReason + workflowStatus of the task.
      findUnique: async () => {
        if (holdReadFails) throw new Error('connection closed');
        return { haltReason, workflowStatus: 'verify_done' };
      },
      updateMany: async () => ({ count: 0 }),
    },
    agentExecution: { findFirst: verifierLookup, findMany: async () => [] },
    workflowTransition: {
      findFirst: async (a: { where?: { cause?: unknown } }) =>
        // The hold row lookup asks for one cause; the completion check asks for a list.
        typeof a.where?.cause === 'string'
          ? { metadata: { holdReason: 'ineligible_verifier' } }
          : OVERRIDE,
    },
  },
}));

const { verifierConfirmedForCompletion } = await import('./verifier-completion-check');
const { probeReviewHold, readReviewHold } = await import('./review-hold');

beforeEach(() => {
  holdReadFails = false;
  haltReason = null;
  verifierLookup.mockClear();
});

test('レビューの再現：保留を読めないときは、束縛が一致する override があっても完了を許さない', async () => {
  holdReadFails = true;
  expect(await verifierConfirmedForCompletion(1471, 'merge_watcher')).toBe(false);
});

test('保留がないと確認できれば、束縛が一致する override で完了を許す（対照）', async () => {
  expect(await verifierConfirmedForCompletion(1471, 'merge_watcher')).toBe(true);
  expect(verifierLookup).not.toHaveBeenCalled();
});

test('保留中なら完了を許さない（対照）', async () => {
  haltReason = 'awaiting_review_decision';
  expect(await verifierConfirmedForCompletion(1471, 'merge_watcher')).toBe(false);
});

test('probeReviewHold は「保留なし」「保留中」「確認不能」を区別する', async () => {
  expect((await probeReviewHold(1471)).state).toBe('clear');
  haltReason = 'awaiting_review_decision';
  expect((await probeReviewHold(1471)).state).toBe('held');
  holdReadFails = true;
  expect((await probeReviewHold(1471)).state).toBe('unknown');
  // The never-throwing reader used by the UI route keeps its contract.
  expect(await readReviewHold(1471)).toBeNull();
});
