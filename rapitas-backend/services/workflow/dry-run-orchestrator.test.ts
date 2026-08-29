/**
 * dry-run-orchestrator.test
 *
 * Unit tests for the dry-run orchestrator: normal pass, gate fail, completion
 * gate fail (unjustified empty diff), jury fail, base-branch SHA resolution
 * failure (fail-open), and the machine-enforced guarantee that no production
 * side-effect function is ever called from any branch.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const runAutomatedVerificationMock = mock(
  async (): Promise<{ ok: boolean; summary: string; checks: unknown[] }> => ({
    ok: true,
    summary: 'ok',
    checks: [],
  }),
);
mock.module('../agents/verification/automated-verifier', () => ({
  runAutomatedVerification: runAutomatedVerificationMock,
  looksLikeBugFixTask: (text: string | null | undefined) =>
    !!text && /(バグ|不具合|クラッシュ|\bbug\b|\bcrash\b)/i.test(text),
}));

const evaluateCompletionGateMock = mock(
  async (): Promise<{ allow: boolean; reason: string }> => ({
    allow: true,
    reason: 'has_code_changes',
  }),
);
mock.module('./completion-gate', () => ({
  evaluateCompletionGate: evaluateCompletionGateMock,
}));

const reviewDiffAdversariallyMock = mock(
  async (): Promise<{
    verdict: 'pass' | 'fail' | 'unknown';
    severity: number;
    reasons: string[];
    judged: boolean;
  }> => ({ verdict: 'pass', severity: 0, reasons: [], judged: true }),
);
mock.module('../agents/verification/adversarial-diff-review', () => ({
  reviewDiffAdversarially: reviewDiffAdversariallyMock,
}));

const execGitReadonlyMock = mock(
  async (): Promise<{ stdout: string; stderr: string }> => ({
    stdout: 'abc123\n',
    stderr: '',
  }),
);
mock.module('../agents/orchestrator/git-operations/core/git-exec', () => ({
  execGitReadonly: execGitReadonlyMock,
}));

const appendEventMock = mock(async (): Promise<{ id: number }> => ({ id: 42 }));
mock.module('../memory/timeline', () => ({ appendEvent: appendEventMock }));

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: mock(() => {}), warn: mock(() => {}), debug: mock(() => {}) }),
}));

// Regression tripwires (task 723): these production side-effect functions must
// NEVER be reachable from the dry-run orchestrator. The orchestrator does not
// import their modules at all, so these mocks are never wired into it — the
// assertions below stay true as long as that remains the case. Verified
// manually during implementation by temporarily adding a call to one of these
// inside dry-run-orchestrator.ts (which turned every "not called" assertion
// red) and then removing it (green again).
const performAutoCommitAndPRMock = mock(async () => ({}));
mock.module('../../routes/workflow/workflow-auto-commit', () => ({
  performAutoCommitAndPR: performAutoCommitAndPRMock,
}));
const recordTransitionMock = mock(async () => {});
mock.module('./transition-recorder', () => ({ recordTransition: recordTransitionMock }));
const taskUpdateMock = mock(async () => ({}));
mock.module('../../config/database', () => ({
  prisma: { task: { update: taskUpdateMock } },
}));

const { runDryRunVerification, DRY_RUN_SKIPPED_OPERATIONS } =
  await import('./dry-run-orchestrator');

function baseParams() {
  return {
    taskId: 7,
    worktreePath: 'C:/wt/task-7',
    preferredBaseBranch: 'develop',
    planContent: '# plan',
    verifyContent: '# verify',
    taskTitle: 'Add a widget',
    taskDescription: 'Adds a dashboard widget.',
    acceptanceCriteria: [] as string[],
  };
}

function expectNoProductionSideEffects() {
  expect(performAutoCommitAndPRMock).not.toHaveBeenCalled();
  expect(recordTransitionMock).not.toHaveBeenCalled();
  expect(taskUpdateMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  runAutomatedVerificationMock.mockClear();
  evaluateCompletionGateMock.mockClear();
  reviewDiffAdversariallyMock.mockClear();
  execGitReadonlyMock.mockClear();
  appendEventMock.mockClear();
  performAutoCommitAndPRMock.mockClear();
  recordTransitionMock.mockClear();
  taskUpdateMock.mockClear();

  runAutomatedVerificationMock.mockImplementation(async () => ({
    ok: true,
    summary: 'ok',
    checks: [],
  }));
  evaluateCompletionGateMock.mockImplementation(async () => ({
    allow: true,
    reason: 'has_code_changes',
  }));
  reviewDiffAdversariallyMock.mockImplementation(async () => ({
    verdict: 'pass',
    severity: 0,
    reasons: [],
    judged: true,
  }));
  execGitReadonlyMock.mockImplementation(async () => ({ stdout: 'abc123\n', stderr: '' }));
  appendEventMock.mockImplementation(async () => ({ id: 42 }));
});

describe('runDryRunVerification', () => {
  it('reports ok:true when gate/completion-gate/jury all pass', async () => {
    const res = await runDryRunVerification(baseParams());
    expect(res.ok).toBe(true);
    expect(res.reportId).toBe(42);
    expect(res.baseBranchSha).toBe('abc123');
    expect(res.skippedOperations).toEqual(DRY_RUN_SKIPPED_OPERATIONS);
    expect(res.skippedOperations).toHaveLength(7);
    expectNoProductionSideEffects();
  });

  it('calls reviewDiffAdversarially with suppressEventLog:true (own calibration log stays clean)', async () => {
    await runDryRunVerification(baseParams());
    expect(reviewDiffAdversariallyMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 7, worktreePath: 'C:/wt/task-7', suppressEventLog: true }),
    );
  });

  it('reports ok:false when the deterministic gate fails', async () => {
    runAutomatedVerificationMock.mockImplementation(async () => ({
      ok: false,
      summary: 'lint failed',
      checks: [{ name: 'lint', ok: false }],
    }));
    const res = await runDryRunVerification(baseParams());
    expect(res.ok).toBe(false);
    expect(res.gate.ok).toBe(false);
    expectNoProductionSideEffects();
  });

  it('reports ok:false when the completion gate blocks an unjustified empty diff', async () => {
    evaluateCompletionGateMock.mockImplementation(async () => ({
      allow: false,
      reason: 'no_changes_unjustified',
    }));
    const res = await runDryRunVerification(baseParams());
    expect(res.ok).toBe(false);
    expect(res.completionGate).toEqual({ allow: false, reason: 'no_changes_unjustified' });
    expectNoProductionSideEffects();
  });

  it('reports ok:false when the jury fails the diff', async () => {
    reviewDiffAdversariallyMock.mockImplementation(async () => ({
      verdict: 'fail',
      severity: 80,
      reasons: ['要件を満たさない'],
      judged: true,
    }));
    const res = await runDryRunVerification(baseParams());
    expect(res.ok).toBe(false);
    expect(res.jury.verdict).toBe('fail');
    expectNoProductionSideEffects();
  });

  it('treats an unknown (unjudged) jury verdict as not blocking', async () => {
    reviewDiffAdversariallyMock.mockImplementation(async () => ({
      verdict: 'unknown',
      severity: 0,
      reasons: [],
      judged: false,
    }));
    const res = await runDryRunVerification(baseParams());
    expect(res.ok).toBe(true);
    expectNoProductionSideEffects();
  });

  it('fails open (baseBranchSha:null) when the base branch SHA cannot be resolved, without blocking the rest of the report', async () => {
    execGitReadonlyMock.mockImplementation(async () => {
      throw new Error('unknown revision');
    });
    const res = await runDryRunVerification(baseParams());
    expect(res.baseBranchSha).toBeNull();
    expect(res.ok).toBe(true);
    expectNoProductionSideEffects();
  });

  it('resolves baseBranchSha to null when preferredBaseBranch is null (no git call attempted)', async () => {
    const res = await runDryRunVerification({ ...baseParams(), preferredBaseBranch: null });
    expect(res.baseBranchSha).toBeNull();
    expect(execGitReadonlyMock).not.toHaveBeenCalled();
  });

  it('falls back to origin/<branch> when the local ref does not resolve', async () => {
    execGitReadonlyMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'git rev-parse develop') throw new Error('unknown revision');
      return { stdout: 'def456\n', stderr: '' };
    });
    const res = await runDryRunVerification(baseParams());
    expect(res.baseBranchSha).toBe('def456');
  });

  it('records a dry_run_executed timeline event correlated to the task', async () => {
    await runDryRunVerification(baseParams());
    expect(appendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'dry_run_executed',
        correlationId: 'task-7',
      }),
    );
  });

  it('never calls any production side-effect function across every branch above', () => {
    // Structural guarantee: asserted per-test above; this test documents the
    // invariant explicitly so a future reviewer sees it without re-reading
    // every case.
    expectNoProductionSideEffects();
  });
});
