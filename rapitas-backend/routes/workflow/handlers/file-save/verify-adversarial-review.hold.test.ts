/**
 * verify-adversarial-review.hold テスト
 *
 * A review that cannot be settled ('hold') parks the task for a human on the
 * HTTP verify.md save path: no implementer bounce, no commit/PR, and a
 * 'stopped' jury-gate completion so the CLI epilogue does not commit past it.
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const mockFindUnique = mock(() => Promise.resolve({ workflowStatus: 'verify_done' })) as any;
const mockPrisma = {
  task: {
    findUnique: mockFindUnique,
    update: mock(() => Promise.resolve({})),
    updateMany: mock(() => Promise.resolve({ count: 1 })),
  },
  agentSession: { findFirst: mock(() => Promise.resolve({ worktreePath: '/wt/1' })) },
  workflowFile: { findFirst: mock(() => Promise.resolve({ sha256: 'sha-1' })) },
};
mock.module('../../../../config', () => ({ prisma: mockPrisma }));

const appended: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
mock.module('../../../../services/memory/timeline', () => ({
  appendEvent: mock(async (e: { eventType: string; payload: Record<string, unknown> }) => {
    appended.push(e);
    return { id: appended.length };
  }),
  queryEvents: mock(async () => ({ events: [], total: 0 })),
}));
mock.module('../../../../services/workflow/transition-recorder', () => ({
  recordTransition: mock(() => Promise.resolve()),
}));
mock.module('./shared', () => ({
  markLatestExecutionFailed: mock(() => Promise.resolve()),
  wasNonConvergenceCutoffJustRecorded: mock(() => Promise.resolve(false)),
}));

const HOLD_REVIEW = {
  verdict: 'hold',
  severity: 90,
  reasons: ['[blocker] null 未処理（根拠: a.ts:1）'],
  judged: true,
  diffFingerprint: 'fp-1',
  findings: [
    {
      severity: 'blocker',
      summary: 'null 未処理',
      evidence: 'a.ts:1',
      gating: true,
      verification: 'undetermined',
    },
  ],
  seats: [{ seatId: 'reviewer-1' }, { seatId: 'reviewer-2' }, { seatId: 'verifier' }],
  dispute: { basis: 'split', verifierAnswered: true, upheld: 0, refuted: 0, undetermined: 1 },
  awaitingHuman: { reason: 'unresolved_dispute', detail: '検証席が判定できませんでした' },
};
const mockReview = mock(() => Promise.resolve(HOLD_REVIEW)) as any;
mock.module('../../../../services/agents/verification/adversarial-diff-review', () => ({
  reviewDiffAdversarially: mockReview,
}));
const mockRecovery = mock(() => Promise.resolve({ recovered: false }));
mock.module('../../../../services/workflow/worktree-rebuild-recovery', () => ({
  tryRecoverFromHistoryContamination: mockRecovery,
  notifyRecoveryFallbackBlocked: mock(() => Promise.resolve()),
}));
const mockAttemptVerifyRepair = mock(() =>
  Promise.resolve({ bounced: true, newStatus: 'plan_approved' }),
) as any;
mock.module('../../../../services/workflow/verify-self-repair', () => ({
  attemptVerifyRepair: mockAttemptVerifyRepair,
}));
const mockHold = mock(() => Promise.resolve('held')) as any;
mock.module('../../../../services/workflow/review-hold', () => ({ holdFromReview: mockHold }));

const { runAdversarialDiffReview } = await import('./verify-adversarial-review');

const params = () => ({
  taskId: 42,
  fileType: 'verify' as const,
  newStatus: 'verify_done',
  verifyGateBlocked: false,
  isConflictResolutionTask: false,
  savedContent: 'verify body',
  preferredBaseBranchForVerify: null,
});

describe('runAdversarialDiffReview — review hold', () => {
  beforeEach(() => {
    appended.length = 0;
    mockHold.mockReset().mockResolvedValue('held');
    mockAttemptVerifyRepair.mockClear();
    mockRecovery.mockClear();
    mockFindUnique.mockReset().mockResolvedValue({ workflowStatus: 'verify_done' });
    mockReview.mockReset().mockResolvedValue(HOLD_REVIEW);
  });

  test('hold → 人間待ちの保留を書き、修復へ回さず、commit/PR を止める', async () => {
    const out = await runAdversarialDiffReview(params());
    expect(mockHold).toHaveBeenCalledTimes(1);
    const arg = mockHold.mock.calls[0][0];
    expect(arg).toMatchObject({ taskId: 42, source: 'http_save' });
    expect(arg.review.awaitingHuman.reason).toBe('unresolved_dispute');
    expect(arg.review.findings[0].verification).toBe('undetermined');
    expect(mockAttemptVerifyRepair).not.toHaveBeenCalled();
    expect(mockRecovery).not.toHaveBeenCalled();
    expect(out).toEqual({
      newStatus: 'verify_done',
      verifyGateBlocked: true,
      staleVerifyRequest: false,
    });
    const done = appended.filter((e) => e.eventType === 'adversarial_review_gate_completed');
    expect(done.map((e) => e.payload.outcome)).toEqual(['stopped']);
  });

  test('保留が書けない（タスクが動いた）なら、この要求は何もしない（stale）', async () => {
    mockHold.mockResolvedValue('cas_lost');
    mockFindUnique.mockResolvedValue({ workflowStatus: 'completed' });
    const out = await runAdversarialDiffReview(params());
    expect(out.staleVerifyRequest).toBe(true);
    expect(out.newStatus).toBe('completed');
    expect(mockAttemptVerifyRepair).not.toHaveBeenCalled();
    expect(appended.filter((e) => e.eventType === 'adversarial_review_gate_completed')).toEqual([]);
  });

  test('高リスクで陪審不成立の hold も同じ保留（理由は jury_unavailable_high_risk）', async () => {
    mockReview.mockResolvedValue({
      ...HOLD_REVIEW,
      judged: false,
      findings: [],
      dispute: undefined,
      awaitingHuman: { reason: 'jury_unavailable_high_risk', detail: '高リスク' },
    });
    const out = await runAdversarialDiffReview(params());
    expect(mockHold.mock.calls[0][0].review.awaitingHuman.reason).toBe(
      'jury_unavailable_high_risk',
    );
    expect(out.verifyGateBlocked).toBe(true);
    expect(mockAttemptVerifyRepair).not.toHaveBeenCalled();
  });
});
