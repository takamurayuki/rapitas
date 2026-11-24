/**
 * verify-fallback-jury-gate.self-verify-reuse.test
 *
 * A harvested verify.md goes through the CLI epilogue's fallback jury, not the
 * HTTP save. When the newest self-verification already passed the diff review
 * for the same diff fingerprint, HEAD and criteria revision, that verdict is
 * reused (jury not called); any change sends it back to the jury
 * (task 1538 受入条件2, CLI path). The real findReusableSelfVerifyReview runs;
 * only its job store and git read are mocked.
 */
import { describe, expect, mock, test, beforeEach } from 'bun:test';

const verifySha = 'sha-v1';
mock.module('../../config', () => ({
  prisma: {
    task: {
      findUnique: mock(async () => ({
        title: 'Add feature',
        githubPrId: null,
        workflowStatus: 'in_progress',
      })),
    },
    workflowFile: { findFirst: mock(async () => ({ sha256: verifySha })) },
    agentSession: { findFirst: mock(async () => ({ worktreePath: '/wt' })) },
  },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

type Ev = { eventType: string; correlationId?: string; payload: Record<string, unknown> };
let timeline: Ev[] = [];
mock.module('../memory/timeline', () => ({
  appendEvent: mock(async (e: Ev) => {
    timeline.unshift(e);
    return { id: timeline.length };
  }),
  queryEvents: mock(async (o: { eventType?: string; correlationId?: string; limit?: number }) => {
    const events = timeline
      .filter(
        (e) =>
          (!o.eventType || e.eventType === o.eventType) &&
          (!o.correlationId || e.correlationId === o.correlationId),
      )
      .slice(0, o.limit ?? 50);
    return { events, total: events.length };
  }),
}));

let currentFp: string | null = 'fp-A';
mock.module('../agents/verification/review-diff-fingerprint', () => ({
  currentDiffFingerprint: mock(async () => currentFp),
  fingerprintDiff: () => currentFp,
}));
type Review = { verdict: string; severity: number; reasons: string[]; diffFingerprint?: string };
let reviewImpl = async (): Promise<Review> => ({
  verdict: 'pass',
  severity: 0,
  reasons: [],
  diffFingerprint: currentFp ?? undefined,
});
const review = mock(() => reviewImpl());
mock.module('../agents/verification/adversarial-diff-review', () => ({
  reviewDiffAdversarially: review,
  isAdversarialReviewEnabled: () => true,
}));
const repair = mock(async (..._a: unknown[]) => ({ bounced: true, newStatus: 'plan_approved' }));
mock.module('./verify-self-repair', () => ({ attemptVerifyRepair: repair }));
const transitions: Array<{ cause: string; toStatus: string }> = [];
mock.module('./transition-recorder', () => ({
  recordTransition: mock(async (t: { cause: string; toStatus: string }) => {
    transitions.push(t);
  }),
}));
mock.module('./blocked-task-write', () => ({ writeBlockedTask: mock(async () => {}) }));
mock.module('./publish/mark-latest-execution-failed', () => ({
  markLatestExecutionFailed: mock(async () => {}),
}));
mock.module('./review-hold', () => ({ holdFromReview: mock(async () => 'held') }));

// Inputs of the real reuse lookup: the newest self-verify job and HEAD.
let headSha = 'h1';
let latestJob: Record<string, unknown> | null = null;
mock.module('../github/git-exec', () => ({ runGitCommand: async () => `${headSha}\n` }));
mock.module('./verification-job-store', () => ({ getLatestJob: async () => latestJob }));

const { fakeJuryRunModule, fakeJuryRunState, EMPTY_CRITERIA_REVISION } =
  await import('./jury-review-run.test-helpers');
mock.module('./jury-review-run', () => fakeJuryRunModule(fakeJuryRunState(() => verifySha)));

const { runFallbackJuryGate } = await import('./verify-fallback-jury-gate');
const { recordJuryGateCompletion, JURY_GATE_COMPLETED_EVENT } =
  await import('./verify-jury-completion');

const completions = () =>
  timeline.filter((e) => e.eventType === JURY_GATE_COMPLETED_EVENT).map((e) => e.payload);

function passedJob(verdict = 'pass'): Record<string, unknown> {
  return {
    runId: 'run-sv',
    taskId: 9,
    status: 'completed',
    ok: true,
    unverifiable: false,
    diffReview: {
      status: 'reviewed',
      verdict,
      severity: 0,
      reasons: [],
      diffFingerprint: 'fp-A',
      headSha: 'h1',
      criteriaRevision: EMPTY_CRITERIA_REVISION,
    },
  };
}

const gate = () =>
  runFallbackJuryGate({
    taskId: 9,
    currentWfStatus: 'in_progress',
    verifyContent: '# verify',
    worktreePath: '/wt',
    actor: 'verifier',
    sessionId: 3,
  });

beforeEach(() => {
  timeline = [];
  transitions.length = 0;
  review.mockClear();
  repair.mockClear();
  currentFp = 'fp-A';
  headSha = 'h1';
  latestJob = passedJob();
  reviewImpl = async () => ({
    verdict: 'pass',
    severity: 0,
    reasons: [],
    diffFingerprint: currentFp ?? undefined,
  });
});

describe('runFallbackJuryGate — self-verify review reuse', () => {
  test('C-1: 差分指紋・HEAD・条件が一致する合格を再利用し、陪審を呼ばず完了記録を残す', async () => {
    const out = await gate();
    expect(review).toHaveBeenCalledTimes(0);
    expect(out.stop).toBe(false);
    expect(completions()).toHaveLength(1);
    expect(completions()[0]).toMatchObject({
      diffFingerprint: 'fp-A',
      verdict: 'pass',
      outcome: 'passed',
      source: 'cli_epilogue',
    });
  });

  test('C-2: HEAD だけが変われば陪審が1回走る', async () => {
    headSha = 'h2';
    await gate();
    expect(review).toHaveBeenCalledTimes(1);
  });

  test('C-3: 差分指紋だけが変われば陪審が1回走る', async () => {
    currentFp = 'fp-B';
    await gate();
    expect(review).toHaveBeenCalledTimes(1);
  });

  test.each(['fail', 'unknown', 'hold'])('C-4: 自己検証の判定が %s なら再利用しない', async (v) => {
    latestJob = passedJob(v);
    await gate();
    expect(review).toHaveBeenCalledTimes(1);
  });

  test('C-5: 再利用できず陪審が不合格なら in_progress から差し戻し、verify_done を書かない', async () => {
    latestJob = null;
    reviewImpl = async () => ({
      verdict: 'fail',
      severity: 80,
      reasons: ['基準1を満たさない'],
      diffFingerprint: 'fp-A',
    });
    const out = await gate();
    expect(review).toHaveBeenCalledTimes(1);
    expect(repair.mock.calls[0][1]).toBe('in_progress');
    expect(out).toMatchObject({ stop: true, phaseStatus: 'plan_approved' });
    expect(transitions.some((t) => t.toStatus === 'verify_done')).toBe(false);
  });

  test('同じ差分を HTTP が不合格で処理済みなら、自己検証の合格があっても stop する', async () => {
    await recordJuryGateCompletion({
      taskId: 9,
      verifySha256: verifySha,
      diffFingerprint: 'fp-A',
      criteriaRevision: EMPTY_CRITERIA_REVISION,
      verdict: 'fail',
      outcome: 'stopped',
      source: 'http_save',
    });
    const out = await gate();
    expect(out).toMatchObject({ stop: true, skipped: 'already_reviewed' });
    expect(review).toHaveBeenCalledTimes(0);
    expect(completions()).toHaveLength(1);
  });
});
