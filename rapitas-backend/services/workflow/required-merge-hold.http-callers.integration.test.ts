/** HTTP公開の実呼び出し元から共通hold・SQLiteまでを接続する。Git等の外部処理だけを置き換える。 */
import { expect, mock, test } from 'bun:test';
import { db, createHeldCandidate, expectHeld } from './required-merge-hold.sqlite-fixture';

mock.module('./verify-settle-artifact-recovery', () => ({
  isAwaitingRequiredMerge: async () => true,
  isAwaitingStagedPrCompletion: async () => false,
  recoverFromLandedArtifact: async () => false,
  hasConflictResolutionPending: async () => false,
}));
mock.module('./publication-cancellation-guard', () => ({
  publicationAborted: async () => false,
  PUBLICATION_CANCELLED_ERROR: '停止',
}));
mock.module('../agents/orchestrator/git-operations/core/core-ops', () => ({
  createCommit: async () => ({ hash: 'abc' }),
}));
mock.module('../agents/orchestrator/git-operations/pr/branch-pr-ops', () => ({
  createPullRequest: async () => ({
    success: true,
    prNumber: 7,
    prUrl: 'https://example.test/pr/7',
  }),
}));
const verifier = await import('../agents/verification/automated-verifier');
mock.module('../agents/verification/automated-verifier', () => ({
  ...verifier,
  runAutomatedVerification: async () => ({ ok: true, summary: '検証通過' }),
}));
mock.module('../github/pr-link', () => ({ linkAutoCreatedPr: async () => {} }));
mock.module('../github/pr-duplicate-guard', () => ({
  findOpenPrForTask: async () => null,
  claimPrCreationLock: async () => true,
  releasePrCreationLock: async () => {},
}));
mock.module('../../routes/agents/execution/post-handlers/post-execution-review-helpers', () => ({
  execAsync: async () => ({ stdout: 'feature/test' }),
  resolveBaseBranch: async () => 'develop',
  getDiff: async () => 'diff --git a/x b/x\n+1',
  runAIReview: async () => ({ approved: true, summary: '通過', issues: [], commitMessage: '修正' }),
  cleanupWorktree: async () => {},
  markTaskDone: async () => {
    throw new Error('CI待ちで完了してはいけない');
  },
}));
mock.module('../../routes/workflow/handlers/file-save/conflict-pr-merge-state', () => ({
  readConflictPrVerdict: async () => ({ state: 'CLEAN', dirty: false }),
}));
mock.module('../../routes/workflow/handlers/file-save/verify-commit-pr-pipeline', () => ({
  runVerifyCommitPrPipeline: async () => {
    throw new Error('競合解消経路は通常公開を呼ばない');
  },
}));

test('post-execution-reviewの実公開後にrunning項目をCI待ちへ移す', async () => {
  const { task, item } = await createHeldCandidate();
  await db.workflowFile.create({
    data: {
      taskId: task.id,
      fileType: 'plan',
      content: '計画',
      sha256: 'x',
      sizeBytes: 6,
    },
  });
  const { reviewAndCommitWorktree } =
    await import('../../routes/agents/execution/post-handlers/post-execution-review');
  await reviewAndCommitWorktree({
    taskId: task.id,
    taskTitle: task.title,
    sessionId: 1,
    workDir: '/test',
    executionDir: '/test/worktree',
    sessionMode: 'workflow-researcher',
  });
  await expectHeld(task.id, item.id, 'post-execution-review');
});

test('verify-commit-prの実競合解消経路がrunning項目をCI待ちへ移す', async () => {
  const { task, item } = await createHeldCandidate();
  const { runVerifyCommitPrCompletion } =
    await import('../../routes/workflow/handlers/file-save/verify-commit-pr');
  const result = await runVerifyCommitPrCompletion({
    taskId: task.id,
    fileType: 'verify',
    newStatus: 'verify_done',
    verifyGateBlocked: false,
    staleVerifyRequest: false,
    isConflictResolutionTask: true,
    conflictTask: { title: task.title, githubPrId: 7 },
    savedContent: '検証通過',
    preferredBaseBranchForVerify: 'develop',
  });
  expect(result.taskMarkedDone).toBe(false);
  await expectHeld(task.id, item.id, 'verify-commit-pr:conflict-resolution');
});
