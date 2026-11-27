/** blocked復旧・親子完了・CLI実関数から共通holdとSQLiteまでを接続する。 */
import { expect, mock, test } from 'bun:test';
import { db, createHeldCandidate, expectHeld } from './required-merge-hold.sqlite-fixture';

mock.module('./verify-settle-artifact-recovery', () => ({
  isAwaitingRequiredMerge: async () => true,
  isAwaitingStagedPrCompletion: async () => false,
  recoverFromLandedArtifact: async () => false,
  hasConflictResolutionPending: async () => false,
}));
mock.module('./verifier-completion-check', () => ({
  verifierConfirmedForCompletion: async () => true,
}));
mock.module('./publish/workflow-auto-commit-binding', () => ({
  publishBindingDrift: async () => null,
}));
mock.module('./verify-self-repair', () => ({ hasFreshVerifyRejection: async () => false }));
mock.module('./completion-gate', () => ({ evaluateCompletionGate: async () => ({ allow: true }) }));
mock.module('./verifier-eligibility', () => ({
  holdIfVerifierIneligible: async () => ({ outcome: 'ok' }),
}));
mock.module('./verify-fallback-jury-gate', () => ({
  runFallbackJuryGate: async () => ({ stop: false }),
}));
mock.module('./requirement-replan-service', () => ({
  attemptRequirementReplan: async () => ({
    committed: false,
    reason: 'no_mismatch',
    completionReceipt: {},
  }),
}));
mock.module('./requirement-replan-commit', () => ({
  assertReviewedTaskCurrent: async () => {},
  completeReviewedTask: async () => ({ committed: false }),
}));
mock.module('./workflow-file-utils', () => ({
  writeWorkflowFile: async () => {},
  readWorkflowFile: async () => '',
}));
mock.module('../../routes/workflow/workflow-auto-commit', () => ({
  performAutoCommitAndPR: async () => ({
    requested: { autoCommit: true, autoCreatePR: true, autoMergePR: true },
    autoCommitResult: { success: true },
    autoPRResult: { success: true },
  }),
  isNoChangeCompletion: () => false,
}));
const policy = await import('./automation-policy');
mock.module('./automation-policy', () => ({
  ...policy,
  resolveAutomationPolicy: async () => ({ autoMergePR: true }),
  resolveLandingMode: () => 'merge',
}));
mock.module('../communication/realtime-service', () => ({
  realtimeService: { broadcast() {}, sendTaskUpdate() {} },
}));

test('blocked-pr-retry-recoveryの実復旧が項目をCI待ちへ移す', async () => {
  const { task, item } = await createHeldCandidate('blocked');
  const { attemptPrOnlyRecovery } = await import('./blocked-pr-retry-recovery');
  expect(await attemptPrOnlyRecovery(task.id)).toBe('held');
  await expectHeld(task.id, item.id, 'blocked-pr-retry-recovery');
});

test('subtask-completion-handlerの実親完了経路が項目をCI待ちへ移す', async () => {
  const { task, item } = await createHeldCandidate();
  const child = await db.task.create({
    data: {
      title: '子',
      parentId: task.id,
      status: 'done',
      workflowStatus: 'completed',
    },
  });
  const { onSubtaskCompleted } = await import('./subtask-completion-handler');
  await onSubtaskCompleted(child.id);
  await expectHeld(task.id, item.id, 'subtask-completion-handler');
});

test('workflow-cli-executor-verify-gateの実epilogueが項目をCI待ちへ移す', async () => {
  const { task, item } = await createHeldCandidate();
  const { resolveVerifyPhaseStatus } = await import('./workflow-cli-executor-verify-gate');
  await resolveVerifyPhaseStatus({
    taskId: task.id,
    transition: { role: 'verifier' },
    session: { id: 1 },
    currentWfStatus: 'verify_done',
    fileContent: '検証通過',
    validation: { ok: true, severity: 0 },
    resolvedWorktreePath: '/test',
  } as Parameters<typeof resolveVerifyPhaseStatus>[0]);
  await expectHeld(task.id, item.id, 'WorkflowCLIExecutor');
});

test.each(['verify', 'advancing'])(
  'review-hold-publishの実公開後にphase=%sを尊重する',
  async (phase) => {
    const { task, item } = await createHeldCandidate('in-progress', phase);
    const { publishAfterReviewOverride } = await import('./review-hold-publish');
    const result = await publishAfterReviewOverride(
      task.id,
      '検証通過',
      {
        binding: { worktreePath: '/test' },
        hold: { reason: 'unresolved_dispute', detail: '', findings: [] },
      } as Parameters<typeof publishAfterReviewOverride>[2],
      {
        performAutoCommitAndPR: async () => ({
          requested: { autoCommit: true, autoCreatePR: true, autoMergePR: true },
          autoCommitResult: { success: true },
          autoPRResult: { success: true },
        }),
        isNoChangeCompletion: () => false,
        handleVerifyGateBlocked: async () => {},
      } as Parameters<typeof publishAfterReviewOverride>[3],
    );
    expect(result).toBe('held_for_merge');
    await expectHeld(
      task.id,
      item.id,
      'review-hold-override',
      phase === 'advancing' ? phase : 'ci_wait',
    );
  },
);
