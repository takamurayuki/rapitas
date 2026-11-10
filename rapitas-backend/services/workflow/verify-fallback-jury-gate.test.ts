/**
 * verify-fallback-jury-gate.test
 *
 * A harvested verify.md (the agent never PUT it, so the HTTP save pipeline
 * and its jury never ran) must pass the same jury before the epilogue commits
 * and opens a PR, and a FAIL must be handled like the HTTP path handles it.
 */
import { describe, expect, mock, test, beforeEach } from 'bun:test';

const taskFindUnique = mock(
  async (_a: unknown): Promise<{ title: string; githubPrId: number | null } | null> => ({
    title: 'Add feature',
    githubPrId: null,
  }),
);
const workflowFileFindFirst = mock(
  async (_a: unknown): Promise<{ updatedAt: Date } | null> => ({ updatedAt: new Date(1000) }),
);
const sessionFindFirst = mock(async (_a: unknown) => ({ worktreePath: '/wt/from-session' }));
mock.module('../../config', () => ({
  prisma: {
    task: { findUnique: taskFindUnique },
    workflowFile: { findFirst: workflowFileFindFirst },
    agentSession: { findFirst: sessionFindFirst },
  },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const queryEvents = mock(async (_o: unknown) => ({ events: [] as unknown[], total: 0 }));
mock.module('../memory/timeline', () => ({
  queryEvents,
  appendEvent: mock(async () => ({ id: 1 })),
}));

type Review = { verdict: string; severity: number; reasons: string[]; findings?: unknown[] };
const review = mock(
  async (_p: unknown): Promise<Review> => ({ verdict: 'pass', severity: 0, reasons: [] }),
);
mock.module('../agents/verification/adversarial-diff-review', () => ({
  reviewDiffAdversarially: review,
}));

const repair = mock(
  async (
    ..._a: unknown[]
  ): Promise<{
    bounced: boolean;
    newStatus?: string;
    stale?: boolean;
    cutoffRecorded?: boolean;
  }> => ({
    bounced: true,
    newStatus: 'plan_approved',
  }),
);
mock.module('./verify-self-repair', () => ({ attemptVerifyRepair: repair }));

const recordTransition = mock(async (_t: unknown) => {});
mock.module('./transition-recorder', () => ({ recordTransition }));
const writeBlockedTask = mock(async () => {});
mock.module('./blocked-task-write', () => ({ writeBlockedTask }));
const markFailed = mock(async () => {});
mock.module('../../routes/workflow/handlers/file-save/shared', () => ({
  markLatestExecutionFailed: markFailed,
}));

const { runFallbackJuryGate } = await import('./verify-fallback-jury-gate');

const params = (over: Record<string, unknown> = {}) => ({
  taskId: 9,
  currentWfStatus: 'in_progress',
  verifyContent: '# verify',
  worktreePath: '/wt' as string | null,
  actor: 'verifier' as const,
  sessionId: 3,
  ...over,
});

beforeEach(() => {
  taskFindUnique.mockReset().mockResolvedValue({ title: 'Add feature', githubPrId: null });
  workflowFileFindFirst.mockReset().mockResolvedValue({ updatedAt: new Date(1000) });
  queryEvents.mockReset().mockResolvedValue({ events: [], total: 0 });
  review.mockReset().mockResolvedValue({ verdict: 'pass', severity: 0, reasons: [] });
  repair.mockReset().mockResolvedValue({ bounced: true, newStatus: 'plan_approved' });
  recordTransition.mockClear();
  writeBlockedTask.mockClear();
  markFailed.mockClear();
});

describe('runFallbackJuryGate', () => {
  test('runs the jury on the epilogue path and lets a pass through', async () => {
    const out = await runFallbackJuryGate(params());
    expect(review).toHaveBeenCalledWith({ taskId: 9, worktreePath: '/wt' });
    expect(out).toEqual({ stop: false });
  });

  test('a FAIL bounces to the implementer and records adversarial_review_failed with findings', async () => {
    review.mockResolvedValueOnce({
      verdict: 'fail',
      severity: 70,
      reasons: ['[major] bug（根拠: a.ts:1）'],
      findings: [{ severity: 'major', summary: 'bug', evidence: 'a.ts:1', gating: true }],
    });
    const out = await runFallbackJuryGate(params());
    expect(out).toEqual({ stop: true, phaseStatus: 'plan_approved' });
    expect(repair).toHaveBeenCalledWith(
      9,
      'in_progress',
      expect.stringContaining('差分レビュー不合格'),
      '# verify',
    );
    expect(markFailed).toHaveBeenCalled();
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: 'adversarial_review_failed',
        toStatus: 'plan_approved',
        metadata: expect.objectContaining({ source: 'cli_epilogue', findings: expect.any(Array) }),
      }),
    );
    expect(writeBlockedTask).not.toHaveBeenCalled();
  });

  test('a FAIL with repairs exhausted blocks the task instead of committing', async () => {
    review.mockResolvedValueOnce({ verdict: 'fail', severity: 90, reasons: ['x'] });
    repair.mockResolvedValueOnce({ bounced: false });
    const out = await runFallbackJuryGate(params());
    expect(out).toEqual({ stop: true, phaseStatus: 'in_progress' });
    expect(writeBlockedTask).toHaveBeenCalled();
  });

  test('a stale verdict stops without bouncing, blocking or recording', async () => {
    review.mockResolvedValueOnce({ verdict: 'fail', severity: 90, reasons: ['x'] });
    repair.mockResolvedValueOnce({ bounced: false, stale: true });
    const out = await runFallbackJuryGate(params());
    expect(out.stop).toBe(true);
    expect(writeBlockedTask).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalled();
  });

  test('skips when the HTTP save pipeline already judged this verify.md', async () => {
    queryEvents.mockResolvedValueOnce({ events: [{ id: 1 }], total: 1 });
    const out = await runFallbackJuryGate(params());
    expect(queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'adversarial_review',
        correlationId: 'task-9',
        since: new Date(1000),
      }),
    );
    expect(out).toEqual({ stop: false, skipped: 'already_reviewed' });
    expect(review).not.toHaveBeenCalled();
  });

  test('skips conflict-resolution tasks like the HTTP path does', async () => {
    taskFindUnique.mockResolvedValueOnce({ title: 'PR #12 の競合を解消', githubPrId: 12 });
    expect(await runFallbackJuryGate(params())).toEqual({
      stop: false,
      skipped: 'conflict_resolution',
    });
    expect(review).not.toHaveBeenCalled();
  });

  test('falls back to the newest session worktree when the epilogue has none', async () => {
    await runFallbackJuryGate(params({ worktreePath: null }));
    expect(review).toHaveBeenCalledWith({ taskId: 9, worktreePath: '/wt/from-session' });
  });

  test('a jury error fails open like the jury itself (no stop)', async () => {
    review.mockRejectedValueOnce(new Error('boom'));
    expect(await runFallbackJuryGate(params())).toEqual({ stop: false });
  });
});
