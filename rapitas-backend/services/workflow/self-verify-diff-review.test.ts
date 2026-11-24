/**
 * self-verify-diff-review.test
 *
 * The self-verify review calls the jury only for a non-empty diff, and a
 * passing review is reusable only for the newest job whose diff fingerprint,
 * HEAD and criteria revision all still match (task 1538 受入条件2・3).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

let headSha = 'head-1';
mock.module('../github/git-exec', () => ({
  runGitCommand: async () => `${headSha}\n`,
}));
mock.module('../../config', () => ({ prisma: {} }));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, debug: () => {} }),
}));

const reviewMock = mock(async (..._args: unknown[]) => ({
  verdict: 'pass',
  severity: 0,
  reasons: [],
  judged: true,
  diffFingerprint: 'fp-1',
}));
mock.module('../agents/verification/adversarial-diff-review', () => ({
  reviewDiffAdversarially: reviewMock,
  isAdversarialReviewEnabled: () => true,
}));
let fingerprint: string | null = 'fp-1';
mock.module('../agents/verification/review-diff-fingerprint', () => ({
  currentDiffFingerprint: async () => fingerprint,
  fingerprintDiff: () => fingerprint,
}));
let criteria: string | null = 'crit-1';
mock.module('../task/task-criteria-revision', () => ({
  readCriteriaRevision: async () => criteria,
}));

type Job = Record<string, unknown> | null;
let latestJob: Job = null;
mock.module('./verification-job-store', () => ({
  getLatestJob: async () => latestJob,
}));

const { runSelfVerifyDiffReview, findReusableSelfVerifyReview } =
  await import('./self-verify-diff-review');

function passingJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: 'run-1',
    taskId: 9,
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
    ...overrides,
  };
}

beforeEach(() => {
  reviewMock.mockClear();
  headSha = 'head-1';
  fingerprint = 'fp-1';
  criteria = 'crit-1';
  latestJob = passingJob();
});

describe('runSelfVerifyDiffReview', () => {
  it('差分が空ならレビューを0回呼び、empty_diff を返す', async () => {
    fingerprint = null;
    const r = await runSelfVerifyDiffReview({ taskId: 9, worktreePath: 'C:/wt', gateOk: true });
    expect(reviewMock).toHaveBeenCalledTimes(0);
    expect(r).toEqual({ status: 'skipped', skippedReason: 'empty_diff' });
  });

  it('差分があればレビューを1回呼び、照合キーを記録する', async () => {
    const r = await runSelfVerifyDiffReview({ taskId: 9, worktreePath: 'C:/wt', gateOk: true });
    expect(reviewMock).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({
      status: 'reviewed',
      verdict: 'pass',
      diffFingerprint: 'fp-1',
      headSha: 'head-1',
      criteriaRevision: 'crit-1',
    });
  });
});

describe('findReusableSelfVerifyReview', () => {
  it('キー3つが一致する合格済みの最新ジョブなら再利用できる', async () => {
    const r = await findReusableSelfVerifyReview(9, 'C:/wt');
    expect(r?.runId).toBe('run-1');
    expect(r?.review).toMatchObject({ verdict: 'pass', judged: true, diffFingerprint: 'fp-1' });
  });

  it('差分指紋だけが変われば再利用しない', async () => {
    fingerprint = 'fp-2';
    expect(await findReusableSelfVerifyReview(9, 'C:/wt')).toBeNull();
  });

  it('HEAD だけが変われば再利用しない', async () => {
    headSha = 'head-2';
    expect(await findReusableSelfVerifyReview(9, 'C:/wt')).toBeNull();
  });

  it('受入条件の版だけが変われば再利用しない', async () => {
    criteria = 'crit-2';
    expect(await findReusableSelfVerifyReview(9, 'C:/wt')).toBeNull();
  });

  it('unknown / hold の判定は再利用しない', async () => {
    for (const verdict of ['unknown', 'hold', 'fail']) {
      latestJob = passingJob({
        diffReview: { ...(passingJob().diffReview as object), verdict },
      });
      expect(await findReusableSelfVerifyReview(9, 'C:/wt')).toBeNull();
    }
  });

  it('ゲート不合格・未確定・未完了のジョブは再利用しない', async () => {
    for (const o of [{ ok: false }, { unverifiable: true }, { status: 'running' }]) {
      latestJob = passingJob(o);
      expect(await findReusableSelfVerifyReview(9, 'C:/wt')).toBeNull();
    }
  });

  it('ジョブが無い・レビューが skipped なら再利用しない', async () => {
    latestJob = null;
    expect(await findReusableSelfVerifyReview(9, 'C:/wt')).toBeNull();
    latestJob = passingJob({ diffReview: { status: 'skipped', skippedReason: 'empty_diff' } });
    expect(await findReusableSelfVerifyReview(9, 'C:/wt')).toBeNull();
  });

  it('現在の差分が空（指紋 null）なら再利用しない', async () => {
    fingerprint = null;
    expect(await findReusableSelfVerifyReview(9, 'C:/wt')).toBeNull();
  });
});
