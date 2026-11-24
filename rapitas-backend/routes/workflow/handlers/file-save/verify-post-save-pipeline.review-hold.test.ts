/**
 * verify-post-save-pipeline.review-hold.test
 *
 * A verify.md save waiting for the diff review whose jury answers `hold` must
 * not write verify_done (task 1538 受入条件4): the real review-hold code parks
 * the task at in_progress with the hold's haltReason. Unlike the review-pending
 * suite, review-hold is NOT mocked here — only the DB (a one-row fake both
 * config specifiers share), the jury and the downstream stages are.
 */
import { describe, expect, it, mock, beforeEach } from 'bun:test';

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

type Row = { workflowStatus: string; status: string; haltReason: string | null };
let row: Row = { workflowStatus: 'in_progress', status: 'in-progress', haltReason: null };
const statusWrites: string[] = [];
type Where = {
  workflowStatus?: string;
  status?: { in: string[] };
  haltReason?: string | null;
  OR?: Array<{ haltReason: string | null }>;
};
function matches(w: Where): boolean {
  if (w.workflowStatus !== undefined && w.workflowStatus !== row.workflowStatus) return false;
  if (w.status && !w.status.in.includes(row.status)) return false;
  if (w.haltReason !== undefined && w.haltReason !== row.haltReason) return false;
  if (w.OR && !w.OR.some((c) => c.haltReason === row.haltReason)) return false;
  return true;
}
const fakePrisma = {
  task: {
    findUnique: mock(async () => ({
      ...row,
      title: 'Feature',
      githubPrId: null,
      updatedAt: new Date(0),
    })),
    updateMany: mock(async (a: { where: Where; data: Partial<Row> }) => {
      if (!matches(a.where)) return { count: 0 };
      if (a.data.workflowStatus) statusWrites.push(a.data.workflowStatus);
      row = { ...row, ...a.data };
      return { count: 1 };
    }),
  },
  agentSession: { findFirst: mock(async () => ({ worktreePath: 'C:/wt/task-38' })) },
  workflowFile: { findFirst: mock(async () => ({ sha256: 'verify-sha' })) },
  workflowTransition: { findFirst: mock(async () => null) },
};
mock.module('../../../../config', () => ({ prisma: fakePrisma }));
mock.module('../../../../config/database', () => ({ prisma: fakePrisma }));
mock.module('../../../../services/memory/timeline', () => ({
  appendEvent: mock(async () => ({ id: 1 })),
  queryEvents: mock(async () => ({ events: [], total: 0 })),
}));
const transitions: Array<{ cause: string; fromStatus: string | null; toStatus: string }> = [];
mock.module('../../../../services/workflow/transition-recorder', () => ({
  recordTransition: mock(async (t: (typeof transitions)[number]) => {
    transitions.push(t);
  }),
}));
mock.module('./shared', () => ({
  markLatestExecutionFailed: mock(async () => {}),
  wasNonConvergenceCutoffJustRecorded: mock(async () => false),
}));
const reviewMock = mock(async () => ({
  verdict: 'hold',
  severity: 80,
  reasons: ['人の判断が必要'],
  diffFingerprint: 'fp-1',
  awaitingHuman: { reason: 'unresolved_dispute', detail: 'x' },
}));
mock.module('../../../../services/agents/verification/adversarial-diff-review', () => ({
  reviewDiffAdversarially: reviewMock,
  isAdversarialReviewEnabled: () => true,
}));
mock.module('../../../../services/workflow/worktree-rebuild-recovery', () => ({
  tryRecoverFromHistoryContamination: async () => ({ recovered: false, reason: 'none' }),
  notifyRecoveryFallbackBlocked: async () => {},
}));
mock.module('../../../../services/workflow/verify-self-repair', () => ({
  attemptVerifyRepair: mock(async () => ({ bounced: true, newStatus: 'plan_approved' })),
}));
const { fakeJuryRunModule, fakeJuryRunState } =
  await import('../../../../services/workflow/jury-review-run.test-helpers');
mock.module('../../../../services/workflow/jury-review-run', () =>
  fakeJuryRunModule(fakeJuryRunState(() => 'verify-sha')),
);
const advanceMock = mock(async (_db: unknown, r: unknown) => r);
mock.module('../../../../services/workflow/requirement-replan-commit', () => ({
  advanceReviewedVerify: advanceMock,
}));
mock.module('../../../../services/task/task-resolver', () => ({
  resolvePreferredBaseBranch: async () => 'develop',
  resolveTaskWorkflowState: async () => ({ workflowStatus: row.workflowStatus }),
}));
const gateMock = mock(async () => ({
  verifyGateBlocked: false,
  completionDeferred: false,
  conflictTask: null,
  isConflictResolutionTask: false,
  preferredBaseBranchForVerify: 'develop',
}));
mock.module('./verify-completion-gate', () => ({ runVerifyCompletionGate: gateMock }));
mock.module('./verify-commit-pr', () => ({
  runVerifyCommitPrCompletion: mock(async (p: { newStatus?: string }) => ({
    newStatus: p.newStatus,
    taskMarkedDone: false,
    autoCommitPRResult: {},
  })),
}));
mock.module('../../../../services/github/git-exec', () => ({
  runGitCommand: async () => 'head-1\n',
}));
mock.module('../../../../services/agents/verification/review-diff-fingerprint', () => ({
  currentDiffFingerprint: async () => 'fp-1',
  fingerprintDiff: () => 'fp-1',
}));
mock.module('../../../../services/task/task-criteria-revision', () => ({
  readCriteriaRevision: async () => 'crit-1',
}));
mock.module('../../../../services/workflow/verification-job-store', () => ({
  getLatestJob: async () => null,
}));

const { admitVerifyForReview } = await import('./verify-review-admission');
const { runVerifyPostSaveAutomation } = await import('./verify-post-save-pipeline');
const { REVIEW_HOLD_CAUSE, REVIEW_HOLD_HALT_REASON } =
  await import('../../../../services/workflow/review-hold-status');

beforeEach(() => {
  row = { workflowStatus: 'in_progress', status: 'in-progress', haltReason: null };
  statusWrites.length = 0;
  transitions.length = 0;
  advanceMock.mockClear();
  gateMock.mockClear();
});

describe('verify.md save — diff review answers hold', () => {
  it('保留でも verify_done を書かず、in_progress のまま人の判断待ちにする', async () => {
    const receipt = { taskId: 38, executionId: 1, evaluatedUpdatedAt: new Date(1), review: {} };
    const admission = await admitVerifyForReview({
      taskId: 38,
      currentStatus: 'in_progress',
      completionReceipt: receipt as never,
    });
    expect(admission.reviewPending).toBe(true);
    await runVerifyPostSaveAutomation({
      completionReceipt: admission.completionReceipt,
      admission,
      taskId: 38,
      fileType: 'verify',
      newStatus: 'verify_done',
      savedContent: 'verify body',
    });
    expect(reviewMock).toHaveBeenCalled();
    expect(statusWrites).not.toContain('verify_done');
    expect(row).toMatchObject({
      workflowStatus: 'in_progress',
      haltReason: REVIEW_HOLD_HALT_REASON,
    });
    const hold = transitions.find((t) => t.cause === REVIEW_HOLD_CAUSE);
    expect(hold).toMatchObject({ fromStatus: 'in_progress', toStatus: 'in_progress' });
    expect(transitions.some((t) => t.toStatus === 'verify_done')).toBe(false);
    expect(advanceMock).toHaveBeenCalledTimes(0);
    expect(gateMock).toHaveBeenCalledTimes(0);
  });
});
