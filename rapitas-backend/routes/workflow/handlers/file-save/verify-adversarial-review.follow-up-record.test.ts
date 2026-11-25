/**
 * verify-adversarial-review.follow-up-record.test
 *
 * Task 1547 step 7 on the HTTP save path: an applied verdict that moved
 * findings to follow-up concerns leaves one adversarial_review_follow_up
 * transition and a jury_gate completion carrying the same `followUp`, both
 * keyed by the JuryReviewRun id. A verdict that was not applied, or that
 * deferred nothing, leaves no such row. Mocks mirror
 * verify-adversarial-review.test.ts.
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const mockFindUnique = mock(() =>
  Promise.resolve({ workflowStatus: 'verify_done', updatedAt: new Date(0) }),
);
let storedVerifySha: string | null = 'sha-v1';
const mockPrisma = {
  task: {
    findUnique: mockFindUnique,
    update: mock(() => Promise.resolve({})),
    updateMany: mock(() => Promise.resolve({ count: 1 })),
  },
  agentSession: { findFirst: mock(() => Promise.resolve({ worktreePath: '/wt/1' })) },
  workflowFile: {
    findFirst: mock(() => Promise.resolve(storedVerifySha ? { sha256: storedVerifySha } : null)),
  },
};
mock.module('../../../../config', () => ({ prisma: mockPrisma }));

const appendedEvents: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
mock.module('../../../../services/memory/timeline', () => ({
  appendEvent: mock(async (e: { eventType: string; payload: Record<string, unknown> }) => {
    appendedEvents.push(e);
    return { id: appendedEvents.length };
  }),
  queryEvents: mock(async () => ({ events: [], total: 0 })),
}));
const completion = () =>
  appendedEvents.filter((e) => e.eventType === 'adversarial_review_gate_completed').at(-1)?.payload;

type Row = { cause: string; metadata?: Record<string, unknown> };
const transitions: Row[] = [];
mock.module('../../../../services/workflow/transition-recorder', () => ({
  recordTransition: mock(async (args: Row) => {
    transitions.push(args);
  }),
}));
const followUpRows = () => transitions.filter((t) => t.cause === 'adversarial_review_follow_up');

mock.module('./shared', () => ({
  markLatestExecutionFailed: mock(() => Promise.resolve()),
  wasNonConvergenceCutoffJustRecorded: mock(() => Promise.resolve(false)),
}));

const mockReview = mock(async (): Promise<Record<string, unknown>> => ({}));
mock.module('../../../../services/agents/verification/adversarial-diff-review', () => ({
  reviewDiffAdversarially: mockReview,
}));
mock.module('../../../../services/workflow/worktree-rebuild-recovery', () => ({
  tryRecoverFromHistoryContamination: mock(() =>
    Promise.resolve({ recovered: false, reason: 'no_offending_files' }),
  ),
  notifyRecoveryFallbackBlocked: mock(() => Promise.resolve()),
}));
const mockRepair = mock(async (): Promise<Record<string, unknown>> => ({ bounced: false }));
mock.module('../../../../services/workflow/verify-self-repair', () => ({
  attemptVerifyRepair: mockRepair,
}));

const { fakeJuryRunModule, fakeJuryRunState } =
  await import('../../../../services/workflow/jury-review-run.test-helpers');
const juryRun = fakeJuryRunState(() => storedVerifySha);
mock.module('../../../../services/workflow/jury-review-run', () => fakeJuryRunModule(juryRun));
const { runAdversarialDiffReview } = await import('./verify-adversarial-review');

const params = () => ({
  taskId: 1547,
  fileType: 'verify' as const,
  newStatus: 'verify_done',
  verifyGateBlocked: false,
  isConflictResolutionTask: false,
  savedContent: 'verify body',
  preferredBaseBranchForVerify: null,
});
const FOLLOW_UP = { count: 2, reasons: ['受入基準1: [major] 否定'], verdictChanged: true };

beforeEach(() => {
  appendedEvents.length = 0;
  transitions.length = 0;
  storedVerifySha = 'sha-v1';
  juryRun.stillBound = true;
  juryRun.acquire = true;
  mockFindUnique
    .mockReset()
    .mockResolvedValue({ workflowStatus: 'verify_done', updatedAt: new Date(0) });
  mockRepair.mockReset().mockResolvedValue({ bounced: false });
  mockReview.mockReset();
});

describe('runAdversarialDiffReview — follow_up record per jury run (task 1547)', () => {
  test('a pass after deferring follow_up records it with the run id, in both places', async () => {
    mockReview.mockResolvedValueOnce({
      verdict: 'pass',
      severity: 0,
      reasons: [],
      diffFingerprint: 'fp-A',
      followUp: FOLLOW_UP,
    });
    await runAdversarialDiffReview(params());
    const rows = followUpRows();
    expect(rows).toHaveLength(1);
    const done = completion()!;
    expect(done.followUp).toEqual(FOLLOW_UP);
    expect(rows[0].metadata).toMatchObject({
      juryRunId: done.juryRunId,
      source: 'http_save',
      verdict: 'pass',
      outcome: 'passed',
      followUp: FOLLOW_UP,
    });
    expect(typeof done.juryRunId).toBe('number');
  });

  test('a fail that still bounces records the deferral next to adversarial_review_failed', async () => {
    mockReview.mockResolvedValueOnce({
      verdict: 'fail',
      severity: 70,
      reasons: ['受入基準2: [major] データを消す（根拠: a.ts:1）'],
      diffFingerprint: 'fp-A',
      followUp: { ...FOLLOW_UP, count: 1, verdictChanged: false },
    });
    await runAdversarialDiffReview(params());
    expect(followUpRows()).toHaveLength(1);
    expect(followUpRows()[0].metadata).toMatchObject({ outcome: 'stopped', verdict: 'fail' });
    expect(transitions.some((t) => t.cause === 'adversarial_review_failed')).toBe(true);
  });

  test('a verdict that was not applied (run no longer bound) records nothing', async () => {
    juryRun.stillBound = false;
    mockReview.mockResolvedValueOnce({
      verdict: 'pass',
      severity: 0,
      reasons: [],
      diffFingerprint: 'fp-A',
      followUp: FOLLOW_UP,
    });
    await runAdversarialDiffReview(params());
    expect(followUpRows()).toHaveLength(0);
  });

  test('a pass that deferred nothing records nothing and no followUp on the completion', async () => {
    mockReview.mockResolvedValueOnce({
      verdict: 'pass',
      severity: 0,
      reasons: [],
      diffFingerprint: 'fp-A',
    });
    await runAdversarialDiffReview(params());
    expect(followUpRows()).toHaveLength(0);
    expect(completion()).toBeDefined();
    expect(completion()!.followUp).toBeUndefined();
  });
});
