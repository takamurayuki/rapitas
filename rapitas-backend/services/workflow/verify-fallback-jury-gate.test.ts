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
// verify.md's stored sha256 — the artifact version the gate judges.
let verifySha = 'sha-v1';
const workflowFileFindFirst = mock(
  async (_a: unknown): Promise<{ sha256: string } | null> => ({ sha256: verifySha }),
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

// In-memory timeline: the completion records are real appendEvent/queryEvents
// round trips through verify-jury-completion.ts (newest first, like the DB).
type Ev = { eventType: string; correlationId?: string; payload: Record<string, unknown> };
let timeline: Ev[] = [];
const appendEvent = mock(async (e: Ev) => {
  timeline.unshift(e);
  return { id: timeline.length };
});
const queryEvents = mock(
  async (o: { eventType?: string; correlationId?: string; limit?: number }) => {
    const events = timeline
      .filter(
        (e) =>
          (!o.eventType || e.eventType === o.eventType) &&
          (!o.correlationId || e.correlationId === o.correlationId),
      )
      .slice(0, o.limit ?? 50);
    return { events, total: events.length };
  },
);
mock.module('../memory/timeline', () => ({ queryEvents, appendEvent }));

// The worktree's current diff fingerprint.
let currentFp: string | null = 'fp-A';
mock.module('../agents/verification/review-diff-fingerprint', () => ({
  currentDiffFingerprint: mock(async () => currentFp),
  fingerprintDiff: () => currentFp,
}));

type Review = {
  verdict: string;
  severity: number;
  reasons: string[];
  findings?: unknown[];
  diffFingerprint?: string | null;
};
const review = mock(
  async (_p: unknown): Promise<Review> => ({
    verdict: 'pass',
    severity: 0,
    reasons: [],
    diffFingerprint: currentFp,
  }),
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
const { withTaskJuryGate, recordJuryGateCompletion, JURY_GATE_COMPLETED_EVENT } =
  await import('./verify-jury-completion');

const completions = () =>
  timeline.filter((e) => e.eventType === JURY_GATE_COMPLETED_EVENT).map((e) => e.payload);

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
  verifySha = 'sha-v1';
  currentFp = 'fp-A';
  timeline = [];
  workflowFileFindFirst.mockClear();
  review.mockReset().mockImplementation(async () => ({
    verdict: 'pass',
    severity: 0,
    reasons: [],
    diffFingerprint: currentFp,
  }));
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
    // Closed with a record bound to the artifact version and reviewed diff.
    expect(completions()).toEqual([
      expect.objectContaining({
        taskId: 9,
        verifySha256: 'sha-v1',
        diffFingerprint: 'fp-A',
        verdict: 'pass',
        outcome: 'passed',
        source: 'cli_epilogue',
      }),
    ]);
  });

  test('a FAIL bounces to the implementer and records adversarial_review_failed with findings', async () => {
    review.mockResolvedValueOnce({
      verdict: 'fail',
      severity: 70,
      reasons: ['[major] bug（根拠: a.ts:1）'],
      findings: [{ severity: 'major', summary: 'bug', evidence: 'a.ts:1', gating: true }],
      diffFingerprint: 'fp-A',
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
    expect(completions()).toEqual([
      expect.objectContaining({ outcome: 'stopped', verdict: 'fail' }),
    ]);
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
    // A verdict that was not acted on is not a completion.
    expect(completions()).toEqual([]);
  });

  test('skips when a completed gate judged this exact verify.md and diff', async () => {
    await recordJuryGateCompletion({
      taskId: 9,
      verifySha256: 'sha-v1',
      diffFingerprint: 'fp-A',
      verdict: 'pass',
      outcome: 'passed',
      source: 'http_save',
    });
    const out = await runFallbackJuryGate(params());
    expect(out).toEqual({ stop: false, skipped: 'already_reviewed' });
    expect(review).not.toHaveBeenCalled();
  });

  test('an adversarial_review event alone (no completion record) is NOT reuse', async () => {
    // The old rule: any jury event newer than verify.md meant "judged". The
    // jury appends it before the HTTP path acts, and it names no artifact.
    timeline.unshift({
      eventType: 'adversarial_review',
      correlationId: 'task-9',
      payload: { taskId: 9, verdict: 'pass' },
    });
    await runFallbackJuryGate(params());
    expect(review).toHaveBeenCalledTimes(1);
  });

  test('a completion for another verify.md version or another diff is not reuse', async () => {
    const base = {
      taskId: 9,
      verdict: 'pass',
      outcome: 'passed' as const,
      source: 'http_save' as const,
    };
    await recordJuryGateCompletion({ ...base, verifySha256: 'sha-v0', diffFingerprint: 'fp-A' });
    await recordJuryGateCompletion({ ...base, verifySha256: 'sha-v1', diffFingerprint: 'fp-OLD' });
    await runFallbackJuryGate(params());
    expect(review).toHaveBeenCalledTimes(1);
  });

  test('an old review finishing late cannot stand in for a newer verify.md', async () => {
    // Gate 1 starts on verify v1; while its jury runs, verify.md is re-saved
    // as v2 (and the code changes to fp-B). Gate 1's verdict arrives late.
    let finishOld!: () => void;
    review.mockImplementationOnce(
      () =>
        new Promise<Review>((resolve) => {
          finishOld = () =>
            resolve({ verdict: 'pass', severity: 0, reasons: [], diffFingerprint: 'fp-A' });
        }),
    );
    const first = runFallbackJuryGate(params());
    await Bun.sleep(5);
    verifySha = 'sha-v2';
    currentFp = 'fp-B';
    const second = runFallbackJuryGate(params());
    await Bun.sleep(5);
    expect(review).toHaveBeenCalledTimes(1); // second waits for the first
    finishOld();
    await first;
    const out = await second;
    // The late v1 verdict was recorded for v1 only; v2 got its own review.
    expect(review).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ stop: false });
    expect(completions().map((c) => [c.verifySha256, c.diffFingerprint])).toEqual([
      ['sha-v2', 'fp-B'],
      ['sha-v1', 'fp-A'],
    ]);
  });

  test('waits for an HTTP gate still deciding, then honours its completed FAIL', async () => {
    // HTTP save pipeline holds the per-task gate while its jury + bounce run.
    let releaseHttp!: () => void;
    const http = withTaskJuryGate(9, async () => {
      await new Promise<void>((r) => (releaseHttp = r));
      await recordJuryGateCompletion({
        taskId: 9,
        verifySha256: 'sha-v1',
        diffFingerprint: 'fp-A',
        verdict: 'fail',
        outcome: 'stopped',
        source: 'http_save',
      });
    });
    taskFindUnique.mockResolvedValue({
      title: 'Add feature',
      githubPrId: null,
      workflowStatus: 'plan_approved',
    } as never);
    const fallback = runFallbackJuryGate(params());
    await Bun.sleep(5);
    expect(review).not.toHaveBeenCalled();
    releaseHttp();
    await http;
    const out = await fallback;
    expect(review).not.toHaveBeenCalled();
    // Never commits over the HTTP rejection; reports the live (bounced) status.
    expect(out).toEqual({ stop: true, phaseStatus: 'plan_approved', skipped: 'already_reviewed' });
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

describe('runFallbackJuryGate — gate wait limit (G2 re-review item 2)', () => {
  test('when the HTTP gate is still deciding past the wait limit, the epilogue stops (no review, no commit)', async () => {
    let releaseHttp!: () => void;
    const http = withTaskJuryGate(9, () => new Promise<void>((r) => (releaseHttp = r)));
    taskFindUnique.mockResolvedValue({
      title: 'Add feature',
      githubPrId: null,
      workflowStatus: 'verify_done',
    } as never);
    const out = await runFallbackJuryGate({ ...params(), gateMaxWaitMs: 10 });
    expect(out).toEqual({ stop: true, phaseStatus: 'verify_done', skipped: 'gate_busy' });
    expect(review).not.toHaveBeenCalled();
    expect(repair).not.toHaveBeenCalled();
    expect(completions()).toEqual([]);
    releaseHttp();
    await http;
  });
});
