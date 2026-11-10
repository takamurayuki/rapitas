/**
 * review-hold テスト
 *
 * The hold reuses the halt columns (every selector already skips a halted
 * task) plus a verify_done → verify_done transition, and never overwrites a
 * different halt.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noop, logger: noop }));

const updateMany = mock(async (_a: unknown) => ({ count: 1 }));
const findUnique = mock(async (_a: unknown): Promise<Record<string, unknown> | null> => null);
const transitionFindFirst = mock(
  async (_a: unknown): Promise<{ metadata: unknown } | null> => null,
);
mock.module('../../config/database', () => ({
  prisma: {
    task: { updateMany, findUnique },
    workflowTransition: { findFirst: transitionFindFirst },
  },
}));
const recordTransition = mock(async (_t: Record<string, unknown>) => {});
mock.module('./transition-recorder', () => ({ recordTransition }));
const appendEvent = mock(async (_e: Record<string, unknown>) => ({ id: 1 }));
mock.module('../memory/timeline', () => ({ appendEvent }));

const {
  holdForHumanReview,
  holdFromReview,
  readReviewHold,
  clearReviewHold,
  REVIEW_HOLD_HALT_REASON,
  REVIEW_HOLD_CAUSE,
  REVIEW_HOLD_RESOLVED_CAUSE,
} = await import('./review-hold');

const FINDING = {
  severity: 'blocker' as const,
  summary: 'null 未処理',
  evidence: 'a.ts:1',
  gating: true,
};

beforeEach(() => {
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  findUnique.mockReset().mockResolvedValue(null);
  transitionFindFirst.mockReset().mockResolvedValue(null);
  recordTransition.mockClear();
  appendEvent.mockClear();
});

describe('holdForHumanReview', () => {
  test('verify_done に止め、停止列に保留理由を書き、遷移と timeline に理由を残す', async () => {
    const r = await holdForHumanReview({
      taskId: 5,
      reason: 'unresolved_dispute',
      detail: '検証席が判定できませんでした',
      findings: [FINDING],
      severity: 90,
      source: 'http_save',
    });
    expect(r).toBe('held');
    const arg = updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(arg.where).toMatchObject({
      id: 5,
      workflowStatus: 'verify_done',
      status: { in: ['in-progress', 'in_progress'] },
    });
    // Never written over a different halt (e.g. the iteration budget's).
    expect(arg.where.OR).toEqual([
      { haltReason: null },
      { haltReason: '' },
      { haltReason: REVIEW_HOLD_HALT_REASON },
    ]);
    expect(arg.data).toMatchObject({
      workflowStatus: 'verify_done',
      haltReason: REVIEW_HOLD_HALT_REASON,
    });
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: REVIEW_HOLD_CAUSE,
        fromStatus: 'verify_done',
        toStatus: 'verify_done',
        metadata: expect.objectContaining({
          holdReason: 'unresolved_dispute',
          findings: [FINDING],
        }),
      }),
    );
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'review_hold', correlationId: 'task-5' }),
    );
  });

  test('CLI 経路の評価状態（in_progress）から verify_done へ移して止める', async () => {
    await holdForHumanReview({
      taskId: 5,
      fromStatus: 'in_progress',
      reason: 'jury_unavailable_high_risk',
      detail: 'x',
      findings: [],
      source: 'cli_epilogue',
    });
    const arg = updateMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where.workflowStatus).toBe('in_progress');
    expect(recordTransition.mock.calls[0][0]).toMatchObject({
      fromStatus: 'in_progress',
      toStatus: 'verify_done',
    });
  });

  test('CAS に負けたら何も記録しない', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    const r = await holdForHumanReview({
      taskId: 5,
      reason: 'unresolved_dispute',
      detail: 'x',
      findings: [],
      source: 'http_save',
    });
    expect(r).toBe('cas_lost');
    expect(recordTransition).not.toHaveBeenCalled();
    expect(appendEvent).not.toHaveBeenCalled();
  });
});

describe('holdFromReview', () => {
  test('レビュー結果から理由・説明・指摘・席・争点・リスク根拠をそのまま記録する', async () => {
    await holdFromReview({
      taskId: 6,
      source: 'cli_epilogue',
      fromStatus: 'in_progress',
      review: {
        severity: 70,
        reasons: ['r'],
        findings: [FINDING],
        awaitingHuman: { reason: 'jury_unavailable_high_risk', detail: 'リスクの根拠: x' },
        seats: [{ seatId: 'reviewer-1' }],
        unavailableRisk: { high: true, source: 'diff_paths' },
      },
    });
    const t = recordTransition.mock.calls[0][0] as { metadata: Record<string, unknown> };
    expect(t.metadata).toMatchObject({
      source: 'cli_epilogue',
      holdReason: 'jury_unavailable_high_risk',
      detail: 'リスクの根拠: x',
      findings: [FINDING],
      severity: 70,
      seats: [{ seatId: 'reviewer-1' }],
      risk: { high: true, source: 'diff_paths' },
    });
  });
});

describe('readReviewHold', () => {
  test('保留中なら最新の保留遷移から理由と指摘を返す', async () => {
    findUnique.mockResolvedValue({
      haltReason: REVIEW_HOLD_HALT_REASON,
      workflowStatus: 'verify_done',
    });
    transitionFindFirst.mockResolvedValue({
      metadata: JSON.stringify({
        holdReason: 'unresolved_dispute',
        detail: 'd',
        findings: [FINDING],
        severity: 90,
      }),
    });
    expect(await readReviewHold(5)).toEqual({
      reason: 'unresolved_dispute',
      detail: 'd',
      findings: [FINDING],
      severity: 90,
    });
  });

  test('別の停止理由・verify_done 以外なら保留ではない', async () => {
    findUnique.mockResolvedValue({
      haltReason: 'iteration_budget_cost',
      workflowStatus: 'verify_done',
    });
    expect(await readReviewHold(5)).toBeNull();
    findUnique.mockResolvedValue({
      haltReason: REVIEW_HOLD_HALT_REASON,
      workflowStatus: 'plan_approved',
    });
    expect(await readReviewHold(5)).toBeNull();
  });
});

describe('clearReviewHold', () => {
  const hold = { reason: 'unresolved_dispute' as const, detail: 'd', findings: [] };

  test('レビュー保留だけを解除し、誰がどう解消したかを記録する', async () => {
    expect(
      await clearReviewHold({
        taskId: 5,
        action: 'override',
        resolvedBy: 'ユーザー操作',
        note: '確認済み',
        hold,
      }),
    ).toBe(true);
    const arg = updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(arg.where).toEqual({
      id: 5,
      workflowStatus: 'verify_done',
      haltReason: REVIEW_HOLD_HALT_REASON,
    });
    expect(arg.data).toEqual({ haltReason: null, haltedAt: null, resumeCondition: null });
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: REVIEW_HOLD_RESOLVED_CAUSE,
        actor: 'user',
        metadata: expect.objectContaining({
          action: 'override',
          resolvedBy: 'ユーザー操作',
          note: '確認済み',
        }),
      }),
    );
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'review_hold_resolved' }),
    );
  });

  test('既に解除済みなら false で、何も記録しない', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect(await clearReviewHold({ taskId: 5, action: 'accept', resolvedBy: 'x', hold })).toBe(
      false,
    );
    expect(recordTransition).not.toHaveBeenCalled();
  });
});
