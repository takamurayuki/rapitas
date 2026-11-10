/**
 * verification-measurement-record.test
 *
 * The jury reads the automated verifier's RAW result (stored server-side),
 * never the verifier's prose, plus verify.md's one-line claim only.
 */
import { describe, expect, mock, test, beforeEach } from 'bun:test';

const appendEvent = mock(async (_e: unknown) => ({ id: 1 }));
const queryEvents = mock(async (_o: unknown) => ({ events: [] as unknown[], total: 0 }));
mock.module('../../memory/timeline', () => ({ appendEvent, queryEvents }));

const {
  recordVerificationMeasurement,
  loadMeasurementForTarget,
  measurementMatchesTarget,
  renderMeasurementForJury,
  extractVerifyClaim,
} = await import('./verification-measurement-record');

const result = {
  ok: false,
  verdict: 'fail' as const,
  summary: 'test failed',
  changedFiles: ['src/a.ts'],
  checks: [
    { name: 'lint' as const, ran: true, ok: true, errorCount: 0, details: '' },
    {
      name: 'test' as const,
      ran: true,
      ok: false,
      errorCount: 2,
      details: 'a.test.ts: expected 1',
    },
  ],
};

beforeEach(() => {
  appendEvent.mockClear();
  queryEvents.mockReset();
});

const target = { worktreePath: '/wt/5', diffFingerprint: 'fp-now' };
const ev = (t: Record<string, unknown> | undefined, ok = false) => ({
  payload: { measuredAt: '2026-11-10T00:00:00Z', target: t, result: { ...result, ok } },
  createdAt: new Date(),
});

describe('recordVerificationMeasurement / loadMeasurementForTarget', () => {
  test('stores the structured result together with what was measured', async () => {
    await recordVerificationMeasurement(5, result, { ...target, executionId: 41 });
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'verification_measured',
        correlationId: 'task-5',
        payload: expect.objectContaining({
          taskId: 5,
          target: { worktreePath: '/wt/5', diffFingerprint: 'fp-now', executionId: 41 },
          result: expect.objectContaining({ ok: false }),
        }),
      }),
    );
  });

  test('returns the measurement of the current worktree + diff', async () => {
    queryEvents.mockResolvedValueOnce({ events: [ev(target)], total: 1 });
    const m = await loadMeasurementForTarget(5, target);
    expect(queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'verification_measured', correlationId: 'task-5' }),
    );
    expect(m.current?.result.checks).toHaveLength(2);
    expect(m.stale).toBe(false);
  });

  test('an earlier failure of a DIFFERENT diff is history, not current evidence', async () => {
    // Previous measurement failed; the code was fixed and this round's
    // measurement failed to run, so the newest record is about the old diff.
    queryEvents.mockResolvedValueOnce({
      events: [ev({ worktreePath: '/wt/5', diffFingerprint: 'fp-old' })],
      total: 1,
    });
    expect(await loadMeasurementForTarget(5, target)).toEqual({ current: null, stale: true });
  });

  test('after a worktree rebuild the old worktree measurement does not count', async () => {
    queryEvents.mockResolvedValueOnce({
      events: [ev({ worktreePath: '/wt/5-before-rebuild', diffFingerprint: 'fp-now' })],
      total: 1,
    });
    expect(await loadMeasurementForTarget(5, target)).toEqual({ current: null, stale: true });
  });

  test('skips a newer non-matching record to find the matching one', async () => {
    queryEvents.mockResolvedValueOnce({
      events: [ev({ worktreePath: '/wt/5', diffFingerprint: 'fp-later' }), ev(target, true)],
      total: 2,
    });
    const m = await loadMeasurementForTarget(5, target);
    expect(m.current?.result.ok).toBe(true);
    expect(m.stale).toBe(true);
  });

  test('legacy records (no target) and an unknown current diff never match', async () => {
    queryEvents.mockResolvedValueOnce({ events: [ev(undefined)], total: 1 });
    expect((await loadMeasurementForTarget(5, target)).current).toBeNull();
    queryEvents.mockResolvedValueOnce({ events: [ev(target)], total: 1 });
    expect(
      (await loadMeasurementForTarget(5, { worktreePath: '/wt/5', diffFingerprint: null })).current,
    ).toBeNull();
  });

  test('nothing measured / malformed / unreadable → no current measurement', async () => {
    queryEvents.mockResolvedValueOnce({ events: [], total: 0 });
    expect(await loadMeasurementForTarget(5, target)).toEqual({ current: null, stale: false });
    queryEvents.mockResolvedValueOnce({ events: [{ payload: { result: {} } }], total: 1 });
    expect((await loadMeasurementForTarget(5, target)).current).toBeNull();
    queryEvents.mockRejectedValueOnce(new Error('db down'));
    expect(await loadMeasurementForTarget(5, target)).toEqual({ current: null, stale: false });
  });

  test('measurementMatchesTarget requires both worktree and diff', () => {
    const m = { taskId: 5, measuredAt: 'T', result, target };
    expect(measurementMatchesTarget(m, target)).toBe(true);
    expect(measurementMatchesTarget(m, { ...target, worktreePath: '/other' })).toBe(false);
    expect(measurementMatchesTarget(m, { ...target, diffFingerprint: 'x' })).toBe(false);
  });
});

describe('renderMeasurementForJury', () => {
  test('renders the measured checks with the failure evidence', () => {
    const text = renderMeasurementForJury({ taskId: 5, measuredAt: 'T', result });
    expect(text).toContain('計測時刻: T');
    expect(text).toContain('test: ❌ 2件');
    expect(text).toContain('a.test.ts: expected 1');
  });
});

describe('extractVerifyClaim', () => {
  test('returns only the normalised label from the 総合判定 line', () => {
    expect(extractVerifyClaim('# 検証\n**総合判定**: ✅ 合格\n理由: 全部通った')).toBe('✅ 合格');
    expect(extractVerifyClaim('**総合判定**: 合格（全テスト通過、設計も妥当）')).toBe('✅ 合格');
  });

  test('takes the label under a 総合判定 heading, dropping the rest of the line', () => {
    expect(extractVerifyClaim('## 総合判定\n\n✅ 合格（全テスト通過）\n\n詳細…')).toBe('✅ 合格');
  });

  test('fail is not misread as pass (不合格 contains 合格)', () => {
    expect(extractVerifyClaim('## 総合判定\n❌ 検証失敗')).toBe('❌ 不合格');
    expect(extractVerifyClaim('総合判定: 不合格')).toBe('❌ 不合格');
    expect(extractVerifyClaim('Overall verdict: FAIL — tests red')).toBe('❌ 不合格');
    expect(extractVerifyClaim('総合判定: ⚠️ 条件付き合格')).toBe('⚠️ 条件付き');
  });

  test("the verifier's prose never passes: no label → null (rendered 記載なし)", () => {
    // G2 review item 8 reproduction: this prose line used to reach the jury verbatim.
    expect(
      extractVerifyClaim('## 総合判定\n全テスト通過と判断した。理由は設計が正しいため。'),
    ).toBeNull();
    expect(extractVerifyClaim('総合判定: 問題なしと考える')).toBeNull();
  });

  test('null when verify.md has no verdict line', () => {
    expect(extractVerifyClaim('## テスト結果\nall green')).toBeNull();
    expect(extractVerifyClaim(null)).toBeNull();
  });
});
