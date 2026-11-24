/**
 * verify-post-save-pipeline.review-pending.test
 *
 * End-to-end over the save-time admission and the post-save pipeline, with the
 * real jury-apply stage (verify-adversarial-review.ts) and only the jury, the
 * DB and the downstream stages mocked (task 1538):
 * - 受入条件4: from the save until the jury passes, verify_done is not written
 * - 受入条件5: a FAIL bounces from in_progress without passing through verify_done
 * - 受入条件2/6: a self-verify pass of the same diff is reused (jury not called,
 *   verify_done right after the save); a changed HEAD or diff runs the jury
 */
import { describe, expect, it, mock, beforeEach } from 'bun:test';

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

let liveStatus = 'in_progress';
const updateManyMock = mock(async (..._a: unknown[]) => ({ count: 1 }));
mock.module('../../../../config', () => ({
  prisma: {
    task: {
      findUnique: mock(async () => ({
        workflowStatus: liveStatus,
        title: 'Feature',
        githubPrId: null,
        updatedAt: new Date(0),
      })),
      updateMany: updateManyMock,
    },
    agentSession: { findFirst: mock(async () => ({ worktreePath: 'C:/wt/task-38' })) },
    workflowFile: { findFirst: mock(async () => ({ sha256: 'verify-sha' })) },
  },
}));
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

type Review = { verdict: string; severity: number; reasons: string[]; diffFingerprint?: string };
let reviewImpl: () => Promise<Review> = async () => ({
  verdict: 'pass',
  severity: 0,
  reasons: [],
  diffFingerprint: 'fp-1',
});
const reviewMock = mock(() => reviewImpl());
mock.module('../../../../services/agents/verification/adversarial-diff-review', () => ({
  reviewDiffAdversarially: reviewMock,
  isAdversarialReviewEnabled: () => true,
}));
mock.module('../../../../services/workflow/worktree-rebuild-recovery', () => ({
  tryRecoverFromHistoryContamination: async () => ({ recovered: false, reason: 'none' }),
  notifyRecoveryFallbackBlocked: async () => {},
}));
const repairMock = mock(async (..._a: unknown[]) => ({
  bounced: true,
  newStatus: 'plan_approved',
  attempt: 1,
}));
mock.module('../../../../services/workflow/verify-self-repair', () => ({
  attemptVerifyRepair: repairMock,
}));
const holdMock = mock(async (..._a: unknown[]) => 'held' as const);
mock.module('../../../../services/workflow/review-hold', () => ({ holdFromReview: holdMock }));
const { fakeJuryRunModule, fakeJuryRunState } =
  await import('../../../../services/workflow/jury-review-run.test-helpers');
mock.module('../../../../services/workflow/jury-review-run', () =>
  fakeJuryRunModule(fakeJuryRunState(() => 'verify-sha')),
);

const advanceMock = mock(async (_db: unknown, r: { evaluatedUpdatedAt: Date }) => ({
  ...r,
  evaluatedUpdatedAt: new Date(5),
}));
mock.module('../../../../services/workflow/requirement-replan-commit', () => ({
  advanceReviewedVerify: advanceMock,
}));
mock.module('../../../../services/task/task-resolver', () => ({
  resolvePreferredBaseBranch: async () => 'develop',
  resolveTaskWorkflowState: async () => ({ workflowStatus: liveStatus }),
}));
const gateMock = mock(async (..._a: unknown[]) => ({
  verifyGateBlocked: false,
  completionDeferred: false,
  conflictTask: null,
  isConflictResolutionTask: false,
  preferredBaseBranchForVerify: 'develop',
}));
mock.module('./verify-completion-gate', () => ({ runVerifyCompletionGate: gateMock }));
const commitPrMock = mock(async (p: { newStatus?: string }) => ({
  newStatus: p.newStatus,
  taskMarkedDone: false,
  autoCommitPRResult: {},
}));
mock.module('./verify-commit-pr', () => ({ runVerifyCommitPrCompletion: commitPrMock }));

// Reuse inputs: the latest self-verify job and the worktree's current key.
let headSha = 'head-1';
let fingerprint = 'fp-1';
let latestJob: Record<string, unknown> | null = null;
mock.module('../../../../services/github/git-exec', () => ({
  runGitCommand: async () => `${headSha}\n`,
}));
mock.module('../../../../services/agents/verification/review-diff-fingerprint', () => ({
  currentDiffFingerprint: async () => fingerprint,
  fingerprintDiff: () => fingerprint,
}));
mock.module('../../../../services/task/task-criteria-revision', () => ({
  readCriteriaRevision: async () => 'crit-1',
}));
mock.module('../../../../services/workflow/verification-job-store', () => ({
  getLatestJob: async () => latestJob,
}));

const { admitVerifyForReview } = await import('./verify-review-admission');
const { runVerifyPostSaveAutomation } = await import('./verify-post-save-pipeline');
const { hasVerifyCompletionInFlight, resetVerifyCompletionRegistry } =
  await import('../../../../services/workflow/verify-completion-inflight');

const receipt = { taskId: 38, executionId: 1, evaluatedUpdatedAt: new Date(1), review: {} };

async function save(): Promise<{ status: string | undefined; reviewPending: boolean }> {
  const admission = await admitVerifyForReview({
    taskId: 38,
    currentStatus: 'in_progress',
    completionReceipt: receipt as never,
  });
  // The immediate path really wrote verify_done; mirror it for the CAS reads.
  if (!admission.reviewPending) liveStatus = 'verify_done';
  const out = await runVerifyPostSaveAutomation({
    completionReceipt: admission.completionReceipt,
    admission,
    taskId: 38,
    fileType: 'verify',
    newStatus: 'verify_done',
    savedContent: 'verify body',
  });
  return { status: out.newStatus, reviewPending: admission.reviewPending };
}

function passedSelfVerifyJob(): Record<string, unknown> {
  return {
    runId: 'run-1',
    taskId: 38,
    status: 'completed',
    ok: true,
    unverifiable: false,
    diffReview: {
      status: 'reviewed',
      verdict: 'pass',
      severity: 0,
      reasons: [],
      diffFingerprint: 'fp-1',
      headSha: 'head-1',
      criteriaRevision: 'crit-1',
    },
  };
}

beforeEach(() => {
  resetVerifyCompletionRegistry();
  liveStatus = 'in_progress';
  headSha = 'head-1';
  fingerprint = 'fp-1';
  latestJob = null;
  transitions.length = 0;
  for (const m of [reviewMock, advanceMock, gateMock, commitPrMock, repairMock, holdMock])
    m.mockClear();
  updateManyMock.mockClear();
  reviewImpl = async () => ({ verdict: 'pass', severity: 0, reasons: [], diffFingerprint: 'fp-1' });
});

describe('verify.md save — diff review pending', () => {
  it('保存から陪審の合格までは verify_done を書かず、合格後に1回だけ書く', async () => {
    let resolveReview!: (r: Review) => void;
    reviewImpl = () => new Promise<Review>((r) => (resolveReview = r));
    const running = save();
    for (let i = 0; i < 50 && reviewMock.mock.calls.length === 0; i++) await Bun.sleep(1);
    expect(reviewMock).toHaveBeenCalledTimes(1);
    expect(advanceMock).toHaveBeenCalledTimes(0);
    expect(gateMock).toHaveBeenCalledTimes(0);
    expect(hasVerifyCompletionInFlight(38)).toBe(true);
    expect(transitions.map((t) => t.cause)).toContain('verify_review_pending');
    expect(transitions.some((t) => t.toStatus === 'verify_done')).toBe(false);

    resolveReview({ verdict: 'pass', severity: 0, reasons: [], diffFingerprint: 'fp-1' });
    const out = await running;
    expect(out.reviewPending).toBe(true);
    expect(advanceMock).toHaveBeenCalledTimes(1);
    expect(gateMock).toHaveBeenCalledTimes(1);
    const gateArgs = gateMock.mock.calls[0][0] as {
      completionReceipt: { evaluatedUpdatedAt: Date };
    };
    expect(gateArgs.completionReceipt.evaluatedUpdatedAt).toEqual(new Date(5));
    expect(out.status).toBe('verify_done');
  });

  it('陪審が不合格なら verify_done を経ず in_progress から差し戻す', async () => {
    reviewImpl = async () => ({ verdict: 'fail', severity: 80, reasons: ['空入力を拒否しない'] });
    const out = await save();
    expect(advanceMock).toHaveBeenCalledTimes(0);
    expect(repairMock).toHaveBeenCalledTimes(1);
    expect(repairMock.mock.calls[0][1]).toBe('in_progress');
    expect(updateManyMock.mock.calls[0][0]).toMatchObject({
      where: { id: 38, workflowStatus: 'in_progress' },
      data: { workflowStatus: 'plan_approved' },
    });
    expect(transitions.some((t) => t.toStatus === 'verify_done')).toBe(false);
    const failed = transitions.find((t) => t.cause === 'adversarial_review_failed');
    expect(failed).toMatchObject({ fromStatus: 'in_progress', toStatus: 'plan_approved' });
    expect(out.status).toBe('plan_approved');
    expect(gateMock).toHaveBeenCalledTimes(0);
  });

  it('陪審が保留なら in_progress から保留に回す', async () => {
    reviewImpl = async () => ({ verdict: 'hold', severity: 0, reasons: ['人の判断が必要'] });
    await save();
    expect(holdMock).toHaveBeenCalledTimes(1);
    expect(holdMock.mock.calls[0][0]).toMatchObject({ fromStatus: 'in_progress' });
    expect(advanceMock).toHaveBeenCalledTimes(0);
  });

  it('合格後の verify_done 書き込みが古くなっていれば何も進めない', async () => {
    advanceMock.mockImplementationOnce(async () => {
      throw new Error('Reviewed verify transition held: stale_task');
    });
    const out = await save();
    expect(gateMock).toHaveBeenCalledTimes(0);
    expect(commitPrMock).toHaveBeenCalledTimes(0);
    expect(out.status).toBe('in_progress');
  });
});

describe('verify.md save — self-verify review reuse', () => {
  it('同じ差分・HEAD・条件の合格があれば陪審を呼ばず、保存直後に verify_done へ進む', async () => {
    latestJob = passedSelfVerifyJob();
    const out = await save();
    expect(out.reviewPending).toBe(false);
    expect(reviewMock).toHaveBeenCalledTimes(0);
    expect(advanceMock).toHaveBeenCalledTimes(1);
    expect(commitPrMock).toHaveBeenCalledTimes(1);
    expect(transitions.map((t) => t.cause)).not.toContain('verify_review_pending');
  });

  it('HEAD だけが変われば陪審が1回走る', async () => {
    latestJob = passedSelfVerifyJob();
    headSha = 'head-2';
    const out = await save();
    expect(out.reviewPending).toBe(true);
    expect(reviewMock).toHaveBeenCalledTimes(1);
  });

  it('差分指紋だけが変われば陪審が1回走る', async () => {
    latestJob = passedSelfVerifyJob();
    fingerprint = 'fp-2';
    const out = await save();
    expect(out.reviewPending).toBe(true);
    expect(reviewMock).toHaveBeenCalledTimes(1);
  });
});
