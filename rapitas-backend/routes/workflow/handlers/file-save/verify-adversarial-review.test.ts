/**
 * verify-adversarial-review テスト
 *
 * task 710: 非収束カットオフ時の `adversarial_review_failed` 二重記録防止を
 * `repair.cutoffRecorded`（attemptVerifyRepair 呼び出し自身が返す帯域内シグナル）
 * で検証する。task 674/705 で導入された DB 読み取りガード
 * (wasNonConvergenceCutoffJustRecorded) は task 715 で同一事象が再発した実測が
 * あり単独では不十分 — このテストは DB 読み取りガードがすり抜けるケース
 * （false を返す）を模擬しても、cutoffRecorded フラグ単体で冗長な
 * recordTransition を止めることを実証する。ブロック処理・実行失敗マークは
 * cutoffRecorded の値に関わらず従来どおり実行されることも検証する。
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

const warnCalls: Array<[unknown, string]> = [];
mock.module('../../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: (fields: unknown, msg: string) => {
      warnCalls.push([fields, msg]);
    },
    error: () => {},
    debug: () => {},
  }),
}));

const mockFindUnique = mock(() =>
  Promise.resolve({ workflowStatus: 'verify_done', updatedAt: new Date(0) }),
) as any;
const mockTaskUpdate = mock(() => Promise.resolve({})) as any;
const mockUpdateMany = mock(() => Promise.resolve({ count: 1 })) as any;
// verify.md's sha256 as stored; mutable so a test can re-save mid-review.
let storedVerifySha: string | null = null;
const mockPrisma = {
  task: { findUnique: mockFindUnique, update: mockTaskUpdate, updateMany: mockUpdateMany },
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
const completionRecords = () =>
  appendedEvents
    .filter((e) => e.eventType === 'adversarial_review_gate_completed')
    .map((e) => e.payload);

const transitionCalls: Array<{ cause: string }> = [];
const mockRecordTransition = mock((args: { cause: string }) => {
  transitionCalls.push(args);
  return Promise.resolve();
}) as any;
mock.module('../../../../services/workflow/transition-recorder', () => ({
  recordTransition: mockRecordTransition,
}));

const mockMarkLatestExecutionFailed = mock(() => Promise.resolve()) as any;
// The DB-read guard is forced to `false` throughout — simulating the task 715
// recurrence where this guard alone failed to catch the duplicate — so every
// test here isolates whether `repair.cutoffRecorded` alone stops the record.
const mockWasNonConvergenceCutoffJustRecorded = mock(() => Promise.resolve(false)) as any;
mock.module('./shared', () => ({
  markLatestExecutionFailed: mockMarkLatestExecutionFailed,
  wasNonConvergenceCutoffJustRecorded: mockWasNonConvergenceCutoffJustRecorded,
}));

const mockReviewDiffAdversarially = mock(() =>
  Promise.resolve({ verdict: 'fail', severity: 92, reasons: ['実装が空'] }),
) as any;
mock.module('../../../../services/agents/verification/adversarial-diff-review', () => ({
  reviewDiffAdversarially: mockReviewDiffAdversarially,
}));

mock.module('../../../../services/workflow/worktree-rebuild-recovery', () => ({
  tryRecoverFromHistoryContamination: mock(() =>
    Promise.resolve({ recovered: false, reason: 'no_offending_files' }),
  ),
  notifyRecoveryFallbackBlocked: mock(() => Promise.resolve()),
}));

const mockAttemptVerifyRepair = mock(() => Promise.resolve({ bounced: false })) as any;
mock.module('../../../../services/workflow/verify-self-repair', () => ({
  attemptVerifyRepair: mockAttemptVerifyRepair,
}));

// The DB jury lock (design 4.5.1) is covered on real SQLite in
// services/workflow/jury-review-run.test.ts; here it is granted and nothing drifts.
const { fakeJuryRunModule, fakeJuryRunState } =
  await import('../../../../services/workflow/jury-review-run.test-helpers');
const juryRun = fakeJuryRunState(() => storedVerifySha);
mock.module('../../../../services/workflow/jury-review-run', () => fakeJuryRunModule(juryRun));
const { runAdversarialDiffReview } = await import('./verify-adversarial-review');

function buildParams() {
  return {
    taskId: 715,
    fileType: 'verify' as const,
    newStatus: 'verify_done',
    verifyGateBlocked: false,
    isConflictResolutionTask: false,
    savedContent: 'verify body',
    preferredBaseBranchForVerify: null,
  };
}

describe('runAdversarialDiffReview — 非収束カットオフの二重記録防止', () => {
  beforeEach(() => {
    transitionCalls.length = 0;
    warnCalls.length = 0;
    mockRecordTransition.mockClear();
    mockTaskUpdate.mockClear();
    mockMarkLatestExecutionFailed.mockClear();
    mockFindUnique
      .mockReset()
      .mockResolvedValue({ workflowStatus: 'verify_done', updatedAt: new Date(0) });
    mockAttemptVerifyRepair.mockReset().mockResolvedValue({ bounced: false });
  });

  test('cutoffRecorded:true なら DB 読み取りガードが false でも adversarial_review_failed を記録しないこと', async () => {
    mockAttemptVerifyRepair.mockResolvedValueOnce({ bounced: false, cutoffRecorded: true });

    const result = await runAdversarialDiffReview(buildParams());

    expect(transitionCalls.some((c) => c.cause === 'adversarial_review_failed')).toBe(false);
    // ブロック処理・実行失敗マークは cutoffRecorded の値に関わらず従来どおり実行される。
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 715, updatedAt: new Date(0) },
        data: expect.objectContaining({ status: 'blocked' }),
      }),
    );
    expect(mockMarkLatestExecutionFailed).toHaveBeenCalledTimes(1);
    expect(result.verifyGateBlocked).toBe(true);
  });

  test('cutoffRecorded が undefined（予算枯渇など非収束カットオフ以外）なら従来どおり記録すること', async () => {
    mockAttemptVerifyRepair.mockResolvedValueOnce({ bounced: false });

    await runAdversarialDiffReview(buildParams());

    expect(transitionCalls.filter((c) => c.cause === 'adversarial_review_failed')).toHaveLength(1);
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 715, updatedAt: new Date(0) },
        data: expect.objectContaining({ status: 'blocked' }),
      }),
    );
  });
});

describe('runAdversarialDiffReview — stale-verdict compare-and-swap (task 783)', () => {
  beforeEach(() => {
    transitionCalls.length = 0;
    warnCalls.length = 0;
    mockRecordTransition.mockClear();
    mockTaskUpdate.mockClear();
    mockMarkLatestExecutionFailed.mockClear();
    mockFindUnique
      .mockReset()
      .mockResolvedValue({ workflowStatus: 'verify_done', updatedAt: new Date(0) });
    mockAttemptVerifyRepair.mockReset().mockResolvedValue({ bounced: false });
  });

  test('タスクが verify_done から既に離脱していれば rollback を完全にスキップし reasons 付きで警告すること', async () => {
    mockFindUnique.mockReset().mockResolvedValue({ workflowStatus: 'completed' });

    const result = await runAdversarialDiffReview(buildParams());

    expect(result.staleVerifyRequest).toBe(true);
    expect(result.newStatus).toBe('completed');
    expect(result.verifyGateBlocked).toBe(false);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(transitionCalls).toHaveLength(0);

    const staleWarn = warnCalls.find(
      ([, msg]) =>
        msg ===
        '[Workflow] Adversarial review FAIL arrived after the workflow moved on — skipping rollback entirely',
    );
    expect(staleWarn).toBeDefined();
    expect((staleWarn?.[0] as { reasons?: string[] })?.reasons).toEqual(['実装が空']);
  });
});

describe('runAdversarialDiffReview — completion record (G2 review item 1)', () => {
  beforeEach(() => {
    appendedEvents.length = 0;
    storedVerifySha = 'sha-v1';
    mockFindUnique
      .mockReset()
      .mockResolvedValue({ workflowStatus: 'verify_done', updatedAt: new Date(0) });
    mockAttemptVerifyRepair.mockReset().mockResolvedValue({ bounced: false });
    mockReviewDiffAdversarially.mockReset();
  });

  test('a PASS is recorded after the gate, bound to verify.md sha256 and the reviewed diff', async () => {
    mockReviewDiffAdversarially.mockResolvedValueOnce({
      verdict: 'pass',
      severity: 0,
      reasons: [],
      diffFingerprint: 'fp-A',
    });
    const out = await runAdversarialDiffReview(buildParams());
    expect(out.verifyGateBlocked).toBe(false);
    expect(completionRecords()).toEqual([
      expect.objectContaining({
        taskId: 715,
        verifySha256: 'sha-v1',
        diffFingerprint: 'fp-A',
        verdict: 'pass',
        outcome: 'passed',
        source: 'http_save',
      }),
    ]);
  });

  test('a FAIL that blocked is recorded as stopped — only after the block was written', async () => {
    mockReviewDiffAdversarially.mockResolvedValueOnce({
      verdict: 'fail',
      severity: 90,
      reasons: ['x'],
      diffFingerprint: 'fp-A',
    });
    let blockedBeforeRecord = false;
    mockTaskUpdate.mockImplementationOnce(async () => {
      blockedBeforeRecord = completionRecords().length === 0;
      return {};
    });
    await runAdversarialDiffReview(buildParams());
    expect(blockedBeforeRecord).toBe(true);
    expect(completionRecords()).toEqual([expect.objectContaining({ outcome: 'stopped' })]);
  });

  test('the sha256 is the one read BEFORE the review (a re-save mid-review is not covered)', async () => {
    mockReviewDiffAdversarially.mockImplementationOnce(async () => {
      storedVerifySha = 'sha-v2'; // verify.md re-saved while the jury ran
      return { verdict: 'pass', severity: 0, reasons: [], diffFingerprint: 'fp-A' };
    });
    await runAdversarialDiffReview(buildParams());
    expect(completionRecords()).toEqual([expect.objectContaining({ verifySha256: 'sha-v1' })]);
  });

  test('a stale verdict (task moved on) writes no completion record', async () => {
    mockReviewDiffAdversarially.mockResolvedValueOnce({
      verdict: 'fail',
      severity: 90,
      reasons: ['x'],
      diffFingerprint: 'fp-A',
    });
    mockFindUnique.mockReset().mockResolvedValue({ workflowStatus: 'completed' });
    const out = await runAdversarialDiffReview(buildParams());
    expect(out.staleVerifyRequest).toBe(true);
    expect(completionRecords()).toEqual([]);
  });
});

describe('runAdversarialDiffReview — gate wait limit (G2 re-review item 2)', () => {
  test('when the other gate is still deciding past the wait limit, this save stops without reviewing or committing', async () => {
    const { withTaskJuryGate } =
      await import('../../../../services/workflow/verify-jury-completion');
    appendedEvents.length = 0;
    mockReviewDiffAdversarially.mockReset();
    mockTaskUpdate.mockClear();
    let releaseOther!: () => void;
    const other = withTaskJuryGate(715, () => new Promise<void>((r) => (releaseOther = r)));
    const out = await runAdversarialDiffReview({ ...buildParams(), gateMaxWaitMs: 10 });
    // Stale = downstream skips both rollback and commit/PR; the holder decides.
    expect(out).toEqual({
      newStatus: 'verify_done',
      verifyGateBlocked: false,
      staleVerifyRequest: true,
    });
    expect(mockReviewDiffAdversarially).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(completionRecords()).toEqual([]);
    releaseOther();
    await other;
  });
});

describe('runAdversarialDiffReview — DB jury lock and pre-apply re-check (design 4.5.1)', () => {
  beforeEach(() => {
    juryRun.acquire = true;
    juryRun.stillBound = true;
    juryRun.discarded = 0;
    juryRun.finished.length = 0;
    mockTaskUpdate.mockClear();
    mockMarkLatestExecutionFailed.mockClear();
    mockReviewDiffAdversarially.mockReset();
    mockAttemptVerifyRepair.mockReset().mockResolvedValue({ bounced: false });
    mockFindUnique
      .mockReset()
      .mockResolvedValue({ workflowStatus: 'verify_done', updatedAt: new Date(0) });
  });

  test('the completion record carries the criteria revision and the run id', async () => {
    mockReviewDiffAdversarially.mockResolvedValueOnce({
      verdict: 'pass',
      severity: 0,
      reasons: [],
      diffFingerprint: 'fp-A',
    });
    await runAdversarialDiffReview(buildParams());
    const last = completionRecords().at(-1);
    expect(last).toEqual(
      expect.objectContaining({
        criteriaRevision: juryRun.criteriaRevision,
        juryRunId: expect.any(Number),
      }),
    );
    expect(juryRun.finished.at(-1)).toEqual(
      expect.objectContaining({ status: 'applied', outcome: 'passed', diffFingerprint: 'fp-A' }),
    );
  });

  test('another run holds the lock → no review, stale (no rollback, no commit/PR)', async () => {
    juryRun.acquire = false;
    const before = completionRecords().length;
    const out = await runAdversarialDiffReview(buildParams());
    expect(out.staleVerifyRequest).toBe(true);
    expect(mockReviewDiffAdversarially).not.toHaveBeenCalled();
    expect(completionRecords().length).toBe(before);
  });

  test('drift after a FAIL → discarded: no bounce, no block, no completion record, stale', async () => {
    juryRun.stillBound = false;
    mockReviewDiffAdversarially.mockResolvedValueOnce({
      verdict: 'fail',
      severity: 90,
      reasons: ['基準2を満たさない'],
      diffFingerprint: 'fp-A',
    });
    const before = completionRecords().length;
    const out = await runAdversarialDiffReview(buildParams());
    expect(out.staleVerifyRequest).toBe(true);
    expect(juryRun.discarded).toBe(1);
    expect(mockAttemptVerifyRepair).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockMarkLatestExecutionFailed).not.toHaveBeenCalled();
    expect(completionRecords().length).toBe(before);
  });

  test('drift after a PASS → stale, so the pipeline does not commit', async () => {
    juryRun.stillBound = false;
    mockReviewDiffAdversarially.mockResolvedValueOnce({
      verdict: 'pass',
      severity: 0,
      reasons: [],
      diffFingerprint: 'fp-A',
    });
    const before = completionRecords().length;
    const out = await runAdversarialDiffReview(buildParams());
    expect(out.staleVerifyRequest).toBe(true);
    expect(completionRecords().length).toBe(before);
  });
});
