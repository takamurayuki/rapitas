/**
 * review-hold-resolve テスト
 *
 * The two resolutions a human may take on a review hold: accept the findings
 * (repair loop) or override (commit/PR proceeds, bound to this artifact+diff).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noop, logger: noop }));
mock.module('../../config/database', () => ({
  prisma: { agentSession: { findFirst: mock(async () => ({ worktreePath: '/wt/5' })) } },
}));

const HOLD = {
  reason: 'unresolved_dispute' as const,
  detail: '検証席が判定できませんでした',
  findings: [
    {
      severity: 'blocker' as const,
      summary: 'null 未処理',
      evidence: 'a.ts:1',
      gating: true,
      verification: 'undetermined' as const,
    },
    { severity: 'minor' as const, summary: '命名', gating: false },
  ],
  severity: 90,
};
const readReviewHold = mock(async (_id: number): Promise<typeof HOLD | null> => HOLD);
const clearReviewHold = mock(async (_p: unknown) => true);
mock.module('./review-hold', () => ({ readReviewHold, clearReviewHold }));

const attemptVerifyRepair = mock(
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
mock.module('./verify-self-repair', () => ({ attemptVerifyRepair }));
const markLatestExecutionFailed = mock(async () => {});
mock.module('../../routes/workflow/handlers/file-save/shared', () => ({
  markLatestExecutionFailed,
}));
const writeBlockedTask = mock(async () => {});
mock.module('./blocked-task-write', () => ({ writeBlockedTask }));
const recordTransition = mock(async (_t: Record<string, unknown>) => {});
mock.module('./transition-recorder', () => ({ recordTransition }));
mock.module('./workflow-file-utils', () => ({ readWorkflowFile: async () => '# verify' }));

const recordJuryGateCompletion = mock(async (_c: Record<string, unknown>) => {});
mock.module('./verify-jury-completion', () => ({
  readVerifySha256: async () => 'sha-5',
  recordJuryGateCompletion,
}));
mock.module('../agents/verification/review-diff-fingerprint', () => ({
  currentDiffFingerprint: async () => 'fp-5',
}));
const publishAfterReviewOverride = mock(async (..._a: unknown[]) => 'completed');
mock.module('./review-hold-publish', () => ({ publishAfterReviewOverride }));
const registerVerifyCompletion = mock((_id: number, _w: Promise<unknown>) => {});
mock.module('./verify-completion-inflight', () => ({ registerVerifyCompletion }));

const { resolveReviewHold } = await import('./review-hold-resolve');

beforeEach(() => {
  readReviewHold.mockReset().mockResolvedValue(HOLD);
  clearReviewHold.mockReset().mockResolvedValue(true);
  attemptVerifyRepair.mockReset().mockResolvedValue({ bounced: true, newStatus: 'plan_approved' });
  writeBlockedTask.mockClear();
  recordTransition.mockClear();
  recordJuryGateCompletion.mockClear();
  publishAfterReviewOverride.mockClear();
  registerVerifyCompletion.mockClear();
});

describe('resolveReviewHold', () => {
  test('保留していなければ何もしない', async () => {
    readReviewHold.mockResolvedValue(null);
    expect(await resolveReviewHold({ taskId: 5, action: 'accept', resolvedBy: 'u' })).toEqual({
      ok: false,
      reason: 'not_held',
    });
    expect(clearReviewHold).not.toHaveBeenCalled();
  });

  test('解除の CAS に負けたら何もしない（二重操作）', async () => {
    clearReviewHold.mockResolvedValue(false);
    expect(await resolveReviewHold({ taskId: 5, action: 'override', resolvedBy: 'u' })).toEqual({
      ok: false,
      reason: 'cas_lost',
    });
    expect(publishAfterReviewOverride).not.toHaveBeenCalled();
  });

  test('(a) 受け入れ → 判定を決めた指摘を差し戻し理由にして修復ループへ', async () => {
    const r = await resolveReviewHold({ taskId: 5, action: 'accept', resolvedBy: 'ユーザー操作' });
    expect(r).toEqual({
      ok: true,
      action: 'accept',
      outcome: 'bounced',
      workflowStatus: 'plan_approved',
    });
    const [taskId, status, reason, content] = attemptVerifyRepair.mock.calls[0] as [
      number,
      string,
      string,
      string,
    ];
    expect([taskId, status, content]).toEqual([5, 'verify_done', '# verify']);
    expect(reason).toContain('null 未処理');
    expect(reason).not.toContain('命名');
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: 'adversarial_review_failed',
        toStatus: 'plan_approved',
        metadata: expect.objectContaining({ source: 'review_hold_accept' }),
      }),
    );
    expect(writeBlockedTask).not.toHaveBeenCalled();
  });

  test('(a) 受け入れで修復上限なら blocked', async () => {
    attemptVerifyRepair.mockResolvedValue({ bounced: false });
    const r = await resolveReviewHold({ taskId: 5, action: 'accept', resolvedBy: 'u' });
    expect(r).toMatchObject({ ok: true, outcome: 'blocked' });
    expect(writeBlockedTask).toHaveBeenCalled();
  });

  test('(b) 上書き → この成果物と差分に束ねて通過を記録し、commit/PR を背景で始める', async () => {
    const r = await resolveReviewHold({
      taskId: 5,
      action: 'override',
      resolvedBy: 'ユーザー操作',
    });
    expect(r).toEqual({
      ok: true,
      action: 'override',
      outcome: 'publishing',
      workflowStatus: 'verify_done',
    });
    expect(recordJuryGateCompletion).toHaveBeenCalledWith({
      taskId: 5,
      verifySha256: 'sha-5',
      diffFingerprint: 'fp-5',
      verdict: 'hold',
      outcome: 'passed',
      source: 'human_override',
    });
    expect(publishAfterReviewOverride).toHaveBeenCalledWith(5, '# verify');
    // Registered in flight so the runner's verify-settle wait sees live work.
    expect(registerVerifyCompletion.mock.calls[0][0]).toBe(5);
    expect(attemptVerifyRepair).not.toHaveBeenCalled();
  });
});
