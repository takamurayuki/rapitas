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
  loadLatestMeasurement,
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

describe('recordVerificationMeasurement / loadLatestMeasurement', () => {
  test('stores the structured result on the task timeline', async () => {
    await recordVerificationMeasurement(5, result);
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'verification_measured',
        correlationId: 'task-5',
        payload: expect.objectContaining({
          taskId: 5,
          result: expect.objectContaining({ ok: false }),
        }),
      }),
    );
  });

  test('reads the newest measurement back', async () => {
    queryEvents.mockResolvedValueOnce({
      events: [{ payload: { measuredAt: '2026-11-10T00:00:00Z', result }, createdAt: new Date() }],
      total: 1,
    });
    const m = await loadLatestMeasurement(5);
    expect(queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'verification_measured',
        correlationId: 'task-5',
        limit: 1,
      }),
    );
    expect(m?.result.checks).toHaveLength(2);
  });

  test('null when nothing was measured or the payload is malformed', async () => {
    queryEvents.mockResolvedValueOnce({ events: [], total: 0 });
    expect(await loadLatestMeasurement(5)).toBeNull();
    queryEvents.mockResolvedValueOnce({ events: [{ payload: { result: {} } }], total: 1 });
    expect(await loadLatestMeasurement(5)).toBeNull();
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
  test('takes the inline claim on the 総合判定 line', () => {
    expect(extractVerifyClaim('# 検証\n**総合判定**: ✅ 合格\n理由: 全部通った')).toBe('✅ 合格');
  });

  test('takes the next non-empty line under a 総合判定 heading', () => {
    expect(extractVerifyClaim('## 総合判定\n\n✅ 合格（全テスト通過）\n\n詳細…')).toBe(
      '✅ 合格（全テスト通過）',
    );
  });

  test('null when verify.md has no verdict line', () => {
    expect(extractVerifyClaim('## テスト結果\nall green')).toBeNull();
    expect(extractVerifyClaim(null)).toBeNull();
  });
});
