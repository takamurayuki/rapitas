/**
 * verify-review-admission.test
 *
 * A passing verify.md save writes verify_done right away only when there is
 * nothing for the diff review to decide (or the self-verification already
 * passed the same diff); otherwise it stays in_progress (task 1538 受入条件4・6).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

let session: { worktreePath: string | null } | null = { worktreePath: 'C:/wt/task-5' };
let task: { title: string; githubPrId: number | null } | null = {
  title: 'Feature',
  githubPrId: null,
};
mock.module('../../../../config', () => ({
  prisma: {
    agentSession: { findFirst: async () => session },
    task: { findUnique: async () => task },
  },
}));
mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const advanceMock = mock(async (_db: unknown, r: { evaluatedUpdatedAt: Date }) => ({
  ...r,
  evaluatedUpdatedAt: new Date(2),
}));
mock.module('../../../../services/workflow/requirement-replan-commit', () => ({
  advanceReviewedVerify: advanceMock,
}));
let enabled = true;
mock.module('../../../../services/agents/verification/adversarial-diff-review', () => ({
  isAdversarialReviewEnabled: () => enabled,
}));
let fingerprint: string | null = 'fp-1';
let reusable: { runId: string; review: Record<string, unknown> } | null = null;
mock.module('../../../../services/workflow/self-verify-diff-review', () => ({
  readSelfVerifyReuseKey: async () => ({
    diffFingerprint: fingerprint,
    headSha: 'head-1',
    criteriaRevision: 'c',
  }),
  findReusableSelfVerifyReview: async () => reusable,
}));
const recordMock = mock(async (..._a: unknown[]) => {});
mock.module('../../../../services/workflow/transition-recorder', () => ({
  recordTransition: recordMock,
}));
mock.module('../../../../services/workflow/verify-review-pending', () => ({
  VERIFY_REVIEW_PENDING_CAUSE: 'verify_review_pending',
}));

const { admitVerifyForReview, recordVerifyReviewPending } =
  await import('./verify-review-admission');

const receipt = { taskId: 5, executionId: 1, evaluatedUpdatedAt: new Date(1), review: {} };
function admit(currentStatus: string | null = 'in_progress') {
  return admitVerifyForReview({
    taskId: 5,
    currentStatus,
    completionReceipt: receipt as never,
  });
}

beforeEach(() => {
  advanceMock.mockClear();
  recordMock.mockClear();
  session = { worktreePath: 'C:/wt/task-5' };
  task = { title: 'Feature', githubPrId: null };
  enabled = true;
  fingerprint = 'fp-1';
  reusable = null;
});

describe('admitVerifyForReview', () => {
  it('差分があり再利用できなければ verify_done にせずレビュー待ちにする', async () => {
    const a = await admit();
    expect(advanceMock).toHaveBeenCalledTimes(0);
    expect(a).toMatchObject({ reviewPending: true, reviewFromStatus: 'in_progress' });
    expect(a.completionReceipt).toBe(receipt as never);
    expect(a.pendingKey).toEqual({ diffFingerprint: 'fp-1', headSha: 'head-1' });
  });

  it('自己検証で同じ差分が合格済みなら直ちに verify_done へ進み、再利用の判定を返す', async () => {
    reusable = { runId: 'run-9', review: { verdict: 'pass', judged: true } };
    const a = await admit();
    expect(advanceMock).toHaveBeenCalledTimes(1);
    expect(a.reviewPending).toBe(false);
    expect(a.reusedRunId).toBe('run-9');
    expect(a.reuseReview).toMatchObject({ verdict: 'pass' });
    expect(a.completionReceipt.evaluatedUpdatedAt).toEqual(new Date(2));
    expect(recordMock).toHaveBeenCalledTimes(0);
  });

  it('差分が空・worktree 無し・レビュー無効・競合解消タスクなら直ちに verify_done', async () => {
    const cases: Array<() => void> = [
      () => (fingerprint = null),
      () => (session = null),
      () => (session = { worktreePath: null }),
      () => (enabled = false),
      () => (task = { title: 'PR #12 の競合を解消する', githubPrId: 3 }),
    ];
    for (const setup of cases) {
      advanceMock.mockClear();
      fingerprint = 'fp-1';
      session = { worktreePath: 'C:/wt/task-5' };
      enabled = true;
      task = { title: 'Feature', githubPrId: null };
      setup();
      const a = await admit();
      expect(a.reviewPending).toBe(false);
      expect(advanceMock).toHaveBeenCalledTimes(1);
    }
  });

  it('保存前が verify_done・不明なら従来どおり直ちに進める', async () => {
    for (const s of ['verify_done', null]) {
      advanceMock.mockClear();
      expect((await admit(s)).reviewPending).toBe(false);
      expect(advanceMock).toHaveBeenCalledTimes(1);
    }
  });

  it('受領証が無ければ従来の文言で投げる', async () => {
    await expect(
      admitVerifyForReview({
        taskId: 5,
        currentStatus: 'in_progress',
        completionReceipt: undefined,
      }),
    ).rejects.toThrow('Missing server completion review receipt');
  });

  it('レビュー待ちの印は状態を変えない遷移として記録する', async () => {
    await recordVerifyReviewPending(5, {
      completionReceipt: receipt as never,
      reviewPending: true,
      reviewFromStatus: 'in_progress',
      pendingKey: { diffFingerprint: 'fp-1', headSha: 'h' },
    });
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: 'in_progress',
        toStatus: 'in_progress',
        cause: 'verify_review_pending',
        phase: 'verify',
        metadata: { diffFingerprint: 'fp-1', headSha: 'h' },
      }),
    );
  });
});
