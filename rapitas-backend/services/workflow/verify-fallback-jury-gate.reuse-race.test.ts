/**
 * verify-fallback-jury-gate.reuse-race.test
 *
 * A self-verify pass matched under the jury lock must still be current when it
 * is applied (task 1538 受入条件2): the DB lock cannot stop git from changing,
 * so a HEAD or diff change after the lookup — injected here at the run's
 * drift check — sends the verdict back to the jury. The jury's own verdict is
 * drift-checked again before it is applied. The real reuse lookup and re-check
 * run; the jury lock is the shared fake (its SQLite form is covered in
 * jury-review-run.test.ts) with a hook on its drift check.
 */
import { describe, expect, mock, test, beforeEach } from 'bun:test';

const verifySha = 'sha-v1';
const TASK_ROW = {
  title: 'Add feature',
  githubPrId: null,
  workflowStatus: 'in_progress',
  haltReason: null as string | null,
};
let taskRow = { ...TASK_ROW };
mock.module('../../config', () => ({
  prisma: {
    task: { findUnique: mock(async () => ({ ...taskRow })) },
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
mock.module('./verify-self-repair', () => ({
  attemptVerifyRepair: mock(async () => ({ bounced: true, newStatus: 'plan_approved' })),
}));
mock.module('./transition-recorder', () => ({ recordTransition: mock(async () => {}) }));
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
const juryRun = fakeJuryRunState(() => verifySha);
const fakeRun = fakeJuryRunModule(juryRun);
// Runs on every drift check, before the fake decides; tests inject changes here.
let onConfirm: (call: number) => void = () => {};
let confirmCalls = 0;
mock.module('./jury-review-run', () => ({
  ...fakeRun,
  confirmJuryRunStillBound: async (...a: Parameters<typeof fakeRun.confirmJuryRunStillBound>) => {
    onConfirm(++confirmCalls);
    return fakeRun.confirmJuryRunStillBound(...a);
  },
}));

const { runFallbackJuryGate } = await import('./verify-fallback-jury-gate');
const { JURY_GATE_COMPLETED_EVENT } = await import('./verify-jury-completion');

const completions = () =>
  timeline.filter((e) => e.eventType === JURY_GATE_COMPLETED_EVENT).map((e) => e.payload);

function passedJob(runId = 'r1'): Record<string, unknown> {
  return {
    runId,
    taskId: 9,
    status: 'completed',
    ok: true,
    unverifiable: false,
    diffReview: {
      status: 'reviewed',
      verdict: 'pass',
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
  taskRow = { ...TASK_ROW };
  juryRun.criteriaRevision = EMPTY_CRITERIA_REVISION;
  juryRun.stillBound = true;
  timeline = [];
  review.mockClear();
  currentFp = 'fp-A';
  headSha = 'h1';
  latestJob = passedJob();
  confirmCalls = 0;
  onConfirm = () => {};
  reviewImpl = async () => ({
    verdict: 'pass',
    severity: 0,
    reasons: [],
    diffFingerprint: currentFp ?? undefined,
  });
});

describe('runFallbackJuryGate — reuse re-checked before it is applied', () => {
  test('C-6: 照合の後に HEAD が変われば陪審を1回呼び、その判定の指紋で記録する', async () => {
    let injected = 0;
    onConfirm = (n) => {
      if (n === 1) {
        headSha = 'h2';
        currentFp = 'fp-H2';
        injected++;
      }
    };
    const out = await gate();
    expect(injected).toBe(1);
    expect(review).toHaveBeenCalledTimes(1);
    expect(out.stop).toBe(false);
    expect(completions()).toHaveLength(1);
    expect(completions()[0]).toMatchObject({ diffFingerprint: 'fp-H2', outcome: 'passed' });
  });

  test('C-7: 照合の後に差分の指紋だけが変われば陪審を1回呼ぶ', async () => {
    onConfirm = (n) => {
      if (n === 1) currentFp = 'fp-B';
    };
    await gate();
    expect(review).toHaveBeenCalledTimes(1);
    expect(completions().some((c) => c.diffFingerprint === 'fp-A')).toBe(false);
  });

  test('C-7b: 照合の後に別の自己検証ジョブが合格すれば陪審を1回呼ぶ', async () => {
    onConfirm = (n) => {
      if (n === 1) latestJob = passedJob('r2');
    };
    await gate();
    expect(review).toHaveBeenCalledTimes(1);
  });

  test('C-8: 何も変わらなければ陪審0回で stop:false、完了記録は1件', async () => {
    const out = await gate();
    expect(review).toHaveBeenCalledTimes(0);
    expect(out.stop).toBe(false);
    expect(confirmCalls).toBe(1);
    expect(completions()).toHaveLength(1);
    expect(completions()[0]).toMatchObject({ diffFingerprint: 'fp-A', outcome: 'passed' });
  });

  test('C-9: 呼び直した陪審の最中に条件が変われば、2回目の確認で止まり記録しない', async () => {
    onConfirm = (n) => {
      if (n === 1) headSha = 'h2';
    };
    reviewImpl = async () => {
      juryRun.stillBound = false;
      return { verdict: 'pass', severity: 0, reasons: [], diffFingerprint: 'fp-A' };
    };
    const out = await gate();
    expect(review).toHaveBeenCalledTimes(1);
    expect(confirmCalls).toBe(2);
    expect(out.stop).toBe(true);
    expect(completions()).toHaveLength(0);
  });
});
