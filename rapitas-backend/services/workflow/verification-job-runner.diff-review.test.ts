/**
 * verification-job-runner.diff-review.test
 *
 * The self-verification job records the adversarial diff review's verdict
 * (pass/fail and its findings) next to the gate result, and never calls the
 * jury when there is no diff or the gate failed (task 1538 受入条件1・3).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

mock.module('../github/git-exec', () => ({
  runGitCommand: mock(async (args: string[]) => (args[0] === 'rev-parse' ? 'head-1\n' : '')),
}));
mock.module('../../config', () => ({
  prisma: {
    task: {
      findUnique: mock(async () => ({ title: 'Feature', description: '', acceptanceCriteria: null })),
    },
  },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, debug: () => {} }),
}));

const runAutomatedVerificationMock = mock(async () => ({ ok: true, summary: 'ok', checks: [] }));
mock.module('../agents/verification/automated-verifier', () => ({
  runAutomatedVerification: runAutomatedVerificationMock,
  renderVerificationMarkdown: () => '# ok',
  looksLikeBugFixTask: () => false,
  requiresTestsForTask: () => false,
}));
mock.module('./workflow-file-utils', () => ({ readWorkflowFile: async () => null }));
mock.module('../task/task-resolver', () => ({ resolvePreferredBaseBranch: async () => 'develop' }));

const recordJobFinishMock = mock(async (..._args: unknown[]) => {});
mock.module('./verification-job-store', () => ({
  recordJobStart: async () => {},
  recordJobFinish: recordJobFinishMock,
  getLatestJob: async () => null,
}));

const reviewMock = mock(async (..._args: unknown[]) => ({
  verdict: 'fail',
  severity: 70,
  reasons: ['UUID 形式で一律拒否している'],
  findings: [{ severity: 'major', summary: 'UUID 形式で一律拒否している' }],
  judged: true,
  diffFingerprint: 'fp-reviewed',
}));
let reviewEnabled = true;
mock.module('../agents/verification/adversarial-diff-review', () => ({
  reviewDiffAdversarially: reviewMock,
  isAdversarialReviewEnabled: () => reviewEnabled,
}));
let fingerprint: string | null = 'fp-1';
mock.module('../agents/verification/review-diff-fingerprint', () => ({
  currentDiffFingerprint: async () => fingerprint,
  fingerprintDiff: () => fingerprint,
}));
mock.module('../task/task-criteria-revision', () => ({
  readCriteriaRevision: async () => 'crit-1',
}));

const { beginVerificationRun, runVerificationGateAndRecord } =
  await import('./verification-job-runner');

async function runJob(): Promise<Record<string, unknown>> {
  const { cacheInputsBefore, keyBefore } = await beginVerificationRun(7, 'C:/wt/task-7');
  await runVerificationGateAndRecord(7, 'run-7', 'C:/wt/task-7', cacheInputsBefore, keyBefore);
  expect(recordJobFinishMock).toHaveBeenCalledTimes(1);
  return recordJobFinishMock.mock.calls[0][2] as Record<string, unknown>;
}

beforeEach(() => {
  recordJobFinishMock.mockClear();
  reviewMock.mockClear();
  runAutomatedVerificationMock.mockClear();
  runAutomatedVerificationMock.mockImplementation(async () => ({
    ok: true,
    summary: 'ok',
    checks: [],
  }));
  reviewEnabled = true;
  fingerprint = 'fp-1';
});

describe('runVerificationGateAndRecord — diff review', () => {
  it('ゲート合格かつ差分ありなら、レビューの合否と指摘を結果に含める', async () => {
    const outcome = await runJob();
    expect(reviewMock).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(true);
    expect(outcome.diffReview).toMatchObject({
      status: 'reviewed',
      verdict: 'fail',
      severity: 70,
      reasons: ['UUID 形式で一律拒否している'],
      diffFingerprint: 'fp-reviewed',
      headSha: 'head-1',
      criteriaRevision: 'crit-1',
    });
    const review = outcome.diffReview as { findings: unknown[] };
    expect(review.findings).toHaveLength(1);
  });

  it('差分が空ならレビューを呼ばず empty_diff として記録する', async () => {
    fingerprint = null;
    const outcome = await runJob();
    expect(reviewMock).toHaveBeenCalledTimes(0);
    expect(outcome.diffReview).toEqual({ status: 'skipped', skippedReason: 'empty_diff' });
  });

  it('ゲートが不合格ならレビューを呼ばない', async () => {
    runAutomatedVerificationMock.mockImplementation(async () => ({
      ok: false,
      summary: 'ng',
      checks: [],
    }));
    const outcome = await runJob();
    expect(reviewMock).toHaveBeenCalledTimes(0);
    expect(outcome.diffReview).toEqual({ status: 'skipped', skippedReason: 'gate_failed' });
  });

  it('レビューが無効ならレビューを呼ばない', async () => {
    reviewEnabled = false;
    const outcome = await runJob();
    expect(reviewMock).toHaveBeenCalledTimes(0);
    expect(outcome.diffReview).toEqual({ status: 'skipped', skippedReason: 'disabled' });
  });

  it('レビューが例外を投げてもジョブは completed のまま unknown を記録する', async () => {
    reviewMock.mockImplementationOnce(async () => {
      throw new Error('jury down');
    });
    const outcome = await runJob();
    expect(outcome.status).toBe('completed');
    expect(outcome.diffReview).toMatchObject({ status: 'reviewed', verdict: 'unknown' });
  });
});
