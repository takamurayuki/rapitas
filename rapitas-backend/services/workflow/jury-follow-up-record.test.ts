/**
 * jury-follow-up-record.test
 *
 * Task 1547 step 7: when an applied jury verdict moved findings to follow-up
 * concerns, one WorkflowTransition row (cause adversarial_review_follow_up)
 * records how many and why, keyed by the JuryReviewRun that decided it. No
 * schema change: the run is referenced by id in the row's metadata.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const recordTransition = mock(async (_t: Record<string, unknown>) => {});
mock.module('./transition-recorder', () => ({ recordTransition }));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const {
  buildFollowUpRecord,
  recordFollowUpDeferral,
  FOLLOW_UP_RECORDED_CAUSE,
  MAX_RECORDED_REASONS,
  MAX_RECORDED_REASON_CHARS,
} = await import('./jury-follow-up-record');

const followUp = (
  count: number,
  reasons: string[] = ['受入基準1: [major] 否定'],
  changed = true,
) => ({
  followUp: { count, reasons, verdictChanged: changed },
});
const input = (review: unknown, over: Record<string, unknown> = {}) => ({
  taskId: 1547,
  juryRunId: 42,
  source: 'http_save' as const,
  review: review as Parameters<typeof buildFollowUpRecord>[0],
  status: 'verify_done',
  outcome: 'passed' as const,
  ...over,
});

beforeEach(() => {
  recordTransition.mockReset().mockResolvedValue(undefined);
});

describe('buildFollowUpRecord', () => {
  test('no review, no followUp, or zero deferred → null', () => {
    expect(buildFollowUpRecord(null)).toBeNull();
    expect(buildFollowUpRecord(undefined)).toBeNull();
    expect(buildFollowUpRecord({})).toBeNull();
    expect(buildFollowUpRecord(followUp(0))).toBeNull();
  });

  test('keeps count and verdictChanged, bounds the reasons', () => {
    const many = Array.from({ length: 15 }, (_, i) => `${i}`.padEnd(400, 'x'));
    const r = buildFollowUpRecord(followUp(15, many, false))!;
    expect(r.count).toBe(15);
    expect(r.verdictChanged).toBe(false);
    expect(MAX_RECORDED_REASONS).toBe(10);
    expect(MAX_RECORDED_REASON_CHARS).toBe(300);
    expect(r.reasons).toHaveLength(10);
    expect(r.reasons.every((s) => s.length <= 300)).toBe(true);
  });

  test('exactly one deferred finding is recorded', () => {
    expect(buildFollowUpRecord(followUp(1))).toEqual({
      count: 1,
      reasons: ['受入基準1: [major] 否定'],
      verdictChanged: true,
    });
  });
});

describe('recordFollowUpDeferral', () => {
  test('writes one non-moving transition keyed by the jury run', async () => {
    await recordFollowUpDeferral(input(followUp(2)));
    expect(recordTransition).toHaveBeenCalledTimes(1);
    const row = recordTransition.mock.calls[0][0];
    expect(FOLLOW_UP_RECORDED_CAUSE).toBe('adversarial_review_follow_up');
    expect(row).toMatchObject({
      taskId: 1547,
      cause: 'adversarial_review_follow_up',
      phase: 'verify',
      actor: 'system',
      fromStatus: 'verify_done',
      toStatus: 'verify_done',
      invariantViolation: false,
      metadata: {
        juryRunId: 42,
        source: 'http_save',
        outcome: 'passed',
        followUp: { count: 2, reasons: ['受入基準1: [major] 否定'], verdictChanged: true },
      },
    });
  });

  test('carries the verdict, actor and session when given', async () => {
    await recordFollowUpDeferral(
      input(
        { verdict: 'fail', ...followUp(1, ['x'], false) },
        {
          source: 'cli_epilogue',
          actor: 'verifier',
          sessionId: 3,
          status: 'plan_approved',
          outcome: 'stopped',
        },
      ),
    );
    expect(recordTransition.mock.calls[0][0]).toMatchObject({
      actor: 'verifier',
      sessionId: 3,
      fromStatus: 'plan_approved',
      toStatus: 'plan_approved',
      metadata: { verdict: 'fail', source: 'cli_epilogue', outcome: 'stopped' },
    });
  });

  test('nothing deferred → nothing written', async () => {
    await recordFollowUpDeferral(input({ verdict: 'pass' }));
    await recordFollowUpDeferral(input(followUp(0)));
    await recordFollowUpDeferral(input(null));
    expect(recordTransition).not.toHaveBeenCalled();
  });

  test('a failing write is swallowed', async () => {
    recordTransition.mockRejectedValueOnce(new Error('db down'));
    await expect(recordFollowUpDeferral(input(followUp(1)))).resolves.toMatchObject({ count: 1 });
  });
});
