/**
 * verify-commit-pr テスト
 *
 * runVerifyCommitPrCompletion の完了遷移CAS（compare-and-swap）を検証:
 * no-change完了 / conflict-resolution完了を同一タスクで並行に2回起動しても、
 * 完了遷移 (recordTransition) が1回しか記録されないこと (task 594 で
 * verify_no_change_confirmed が242ms差で二重記録された実測不具合の回帰防止)。
 * ゲート失敗分岐・PR必須ゲートは workflow-handlers-files.test.ts が担当する。
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

// ---- logger mock ----
mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

// ---- prisma mock with an in-memory workflowStatus for CAS simulation ----
// updateMany honours the `workflowStatus: 'verify_done'` where-clause against
// this shared state, so the FIRST completion flips it and the SECOND gets
// count:0 — the same row-level outcome as two concurrent real requests.
let dbWorkflowStatus = 'verify_done';
const updateManyCalls: unknown[] = [];
const mockUpdateMany = mock(
  (args: { where: { id: number; workflowStatus?: string }; data: Record<string, unknown> }) => {
    updateManyCalls.push(args);
    if (args.where.workflowStatus && args.where.workflowStatus !== dbWorkflowStatus) {
      return Promise.resolve({ count: 0 });
    }
    dbWorkflowStatus = (args.data.workflowStatus as string) ?? dbWorkflowStatus;
    return Promise.resolve({ count: 1 });
  },
) as any;
const mockPrisma = {
  task: {
    updateMany: mockUpdateMany,
    update: mock(() => Promise.resolve({})),
    findUnique: mock(() => Promise.resolve({ githubPrId: null })),
  },
  gitHubPullRequest: { findFirst: mock(() => Promise.resolve(null)) },
  agentSession: { findFirst: mock(() => Promise.resolve(null)) },
};
mock.module('../../../../config', () => ({ prisma: mockPrisma }));

// ---- transition-recorder mock (the duplicate-detection target) ----
const transitionCalls: Array<{ cause: string }> = [];
const mockRecordTransition = mock((args: { cause: string }) => {
  transitionCalls.push(args);
  return Promise.resolve();
}) as any;
mock.module('../../../../services/workflow/transition-recorder', () => ({
  recordTransition: mockRecordTransition,
}));

// ---- workflow-auto-commit mock ----
// Drives the no-change branch: PR requested but not produced, zero-diff commit.
let autoCommitPRResultFixture: Record<string, unknown> = {};
mock.module('../../workflow-auto-commit', () => ({
  performAutoCommitAndPR: mock(() => Promise.resolve(autoCommitPRResultFixture)),
  isNoChangeCompletion: () => true,
}));

// ---- remaining collaborators (not exercised by these paths) ----
mock.module('../../../../services/workflow/automation-policy', () => ({
  resolveLandingMode: () => 'none',
}));
mock.module('../../../../services/workflow/verify-completion-inflight', () => ({
  registerVerifyCompletion: () => {},
}));
mock.module('./shared', () => ({
  markLatestExecutionFailed: mock(() => Promise.resolve()),
}));
mock.module('./verify-commit-pr-gate-blocked', () => ({
  handleVerifyGateBlocked: mock(() => Promise.resolve({})),
}));
const sideEffectsCalls: number[] = [];
mock.module('./verify-commit-pr-side-effects', () => ({
  runVerifyCompletionSideEffects: (taskId: number) => {
    sideEffectsCalls.push(taskId);
  },
}));

const { runVerifyCommitPrCompletion } = await import('./verify-commit-pr');

/** Builds the params for one completion invocation. / 1回分の完了処理パラメータを組み立てる。 */
function buildParams(overrides: Partial<Parameters<typeof runVerifyCommitPrCompletion>[0]> = {}) {
  return {
    taskId: 594,
    fileType: 'verify' as const,
    newStatus: 'verify_done',
    verifyGateBlocked: false,
    staleVerifyRequest: false,
    isConflictResolutionTask: false,
    conflictTask: null,
    savedContent: '# 検証結果',
    preferredBaseBranchForVerify: null,
    ...overrides,
  };
}

beforeEach(() => {
  dbWorkflowStatus = 'verify_done';
  updateManyCalls.length = 0;
  transitionCalls.length = 0;
  sideEffectsCalls.length = 0;
  mockRecordTransition.mockClear();
  autoCommitPRResultFixture = {
    requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
    autoCommitResult: { success: true, filesChanged: 0 },
    autoPRResult: { success: false, error: 'nothing to compare' },
  };
});

describe('runVerifyCommitPrCompletion — 完了遷移のCAS（二重記録防止）', () => {
  test('no-change完了を並行2回起動しても verify_no_change_confirmed 遷移が1回のみ記録されること', async () => {
    const [r1, r2] = await Promise.all([
      runVerifyCommitPrCompletion(buildParams()),
      runVerifyCommitPrCompletion(buildParams()),
    ]);

    const noChangeTransitions = transitionCalls.filter(
      (t) => t.cause === 'verify_no_change_confirmed',
    );
    expect(noChangeTransitions.length).toBe(1);
    // 勝者のみ taskMarkedDone / newStatus=completed になること
    const done = [r1, r2].filter((r) => r.taskMarkedDone);
    expect(done.length).toBe(1);
    expect(done[0]!.newStatus).toBe('completed');
    // 完了副作用も勝者の1回のみ発火すること
    expect(sideEffectsCalls.length).toBe(1);
  });

  test('CAS空振り側（後着）は taskMarkedDone:false を返し newStatus を上書きしないこと', async () => {
    // 先着が既に completed へ進めた状態を模擬
    dbWorkflowStatus = 'completed';

    const res = await runVerifyCommitPrCompletion(buildParams());

    expect(res.taskMarkedDone).toBe(false);
    expect(res.newStatus).toBe('verify_done'); // 呼び出し時の newStatus を維持
    expect(transitionCalls.length).toBe(0);
    expect(sideEffectsCalls.length).toBe(0);
  });

  test('conflict-resolution完了を並行2回起動しても conflict_resolution_completed 遷移が1回のみ記録されること', async () => {
    const params = () =>
      buildParams({
        isConflictResolutionTask: true,
        conflictTask: { title: '競合解消', githubPrId: 42 },
      });

    const [r1, r2] = await Promise.all([
      runVerifyCommitPrCompletion(params()),
      runVerifyCommitPrCompletion(params()),
    ]);

    const transitions = transitionCalls.filter((t) => t.cause === 'conflict_resolution_completed');
    expect(transitions.length).toBe(1);
    const done = [r1, r2].filter((r) => r.taskMarkedDone);
    expect(done.length).toBe(1);
  });

  test('conflict-resolution完了のCAS空振り側は遷移を記録せず taskMarkedDone:false を返すこと', async () => {
    dbWorkflowStatus = 'completed';

    const res = await runVerifyCommitPrCompletion(
      buildParams({
        isConflictResolutionTask: true,
        conflictTask: { title: '競合解消', githubPrId: 42 },
      }),
    );

    expect(res.taskMarkedDone).toBe(false);
    expect(transitionCalls.length).toBe(0);
  });
});
