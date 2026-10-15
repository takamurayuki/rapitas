/**
 * worker-health-query unit tests
 *
 * Verifies bucketing, the timeout/retry definitions, same-weekday/hour
 * baselines (4 weeks back) and the pending (null) handling for short history.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const executionFindMany = mock(() => Promise.resolve([] as unknown[]));
const queueFindMany = mock(() => Promise.resolve([] as unknown[]));
mock.module('../../../../../config/database', () => ({
  prisma: {
    agentExecution: { findMany: executionFindMany },
    workflowQueueItem: { findMany: queueFindMany },
  },
}));

import { buildWorkerHealthSeries, getWorkerHealth, isTimeoutError } from './worker-health-query';
import { WORKER_HEALTH_CONFIG } from './worker-health-config';

const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;
// Whole hour so buckets align with epoch hours.
const NOW = new Date('2026-10-12T10:30:00.000Z');
const LAST_BUCKET_START = new Date('2026-10-12T09:00:00.000Z');

const emptyLog = {
  recordingStartedAt: new Date('2026-01-01T00:00:00.000Z'),
  restarts: [] as Date[],
};

beforeEach(() => {
  executionFindMany.mockReset();
  executionFindMany.mockImplementation(() => Promise.resolve([]));
  queueFindMany.mockReset();
  queueFindMany.mockImplementation(() => Promise.resolve([]));
});

describe('isTimeoutError', () => {
  test('matches keywords case-insensitively, English and Japanese', () => {
    expect(isTimeoutError('Command TIMEOUT after 900s')).toBe(true);
    expect(isTimeoutError('処理がタイムアウトしました')).toBe(true);
    expect(isTimeoutError('rate limited')).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
  });
});

describe('buildWorkerHealthSeries', () => {
  test('returns displayHours complete buckets ending at the last full hour', () => {
    const s = buildWorkerHealthSeries({
      executions: [],
      queueItems: [],
      restartLog: emptyLog,
      now: NOW,
    });
    expect(s.points).toHaveLength(WORKER_HEALTH_CONFIG.displayHours);
    const last = s.points[s.points.length - 1];
    expect(last.t).toBe(LAST_BUCKET_START.toISOString());
  });

  test('counts completions and the timeout rate per bucket', () => {
    const at = new Date(LAST_BUCKET_START.getTime() + 10 * 60_000);
    const s = buildWorkerHealthSeries({
      executions: [
        { status: 'completed', completedAt: at, errorMessage: null },
        { status: 'failed', completedAt: at, errorMessage: 'timeout after 900s' },
        { status: 'failed', completedAt: at, errorMessage: 'boom' },
        { status: 'cancelled', completedAt: at, errorMessage: 'timeout' },
      ],
      queueItems: [],
      restartLog: emptyLog,
      now: NOW,
    });
    const last = s.points[s.points.length - 1];
    expect(last.raw.completions).toBe(1);
    // cancelled is user-initiated: excluded from numerator and denominator
    expect(last.raw.timeoutRate).toBeCloseTo(1 / 3, 10);
  });

  test('retry rate is retried items / finished items', () => {
    const at = new Date(LAST_BUCKET_START.getTime() + 5 * 60_000);
    const s = buildWorkerHealthSeries({
      executions: [],
      queueItems: [
        { status: 'completed', retryCount: 0, completedAt: at },
        { status: 'completed', retryCount: 2, completedAt: at },
        { status: 'queued', retryCount: 1, completedAt: null },
      ],
      restartLog: emptyLog,
      now: NOW,
    });
    expect(s.points[s.points.length - 1].raw.retryRate).toBe(0.5);
  });

  test('z is pending (null) when fewer than 3 of the 4 baseline weeks have a value', () => {
    // restarts are unknown before recording: only 2 weeks of recording history
    const log = {
      recordingStartedAt: new Date(LAST_BUCKET_START.getTime() - 2 * WEEK - 6 * HOUR),
      restarts: [] as Date[],
    };
    const s = buildWorkerHealthSeries({
      executions: [],
      queueItems: [],
      restartLog: log,
      now: NOW,
    });
    const last = s.points[s.points.length - 1];
    expect(last.z.restarts).toBeNull();
    expect(last.composite).toBeNull();
  });

  test('uses the same weekday and hour of the previous 4 weeks as baseline', () => {
    const slot = LAST_BUCKET_START.getTime();
    const completions = (offsetMs: number, n: number) =>
      Array.from({ length: n }, () => ({
        status: 'completed',
        completedAt: new Date(slot - offsetMs + 60_000),
        errorMessage: null,
      }));
    const s = buildWorkerHealthSeries({
      executions: [
        ...completions(WEEK, 10),
        ...completions(2 * WEEK, 10),
        ...completions(3 * WEEK, 10),
        ...completions(4 * WEEK, 10),
        ...completions(0, 0),
      ],
      queueItems: [],
      restartLog: emptyLog,
      now: NOW,
    });
    const last = s.points[s.points.length - 1];
    // value 0 vs baseline median 10, MAD 0 -> sigma = floor(1) -> z = -10
    expect(last.raw.completions).toBe(0);
    expect(last.z.completions).toBe(-10);
    expect(last.composite).not.toBeNull();
    expect(Number.isFinite(last.composite as number)).toBe(true);
  });

  test('reports the weights it used', () => {
    const s = buildWorkerHealthSeries({
      executions: [],
      queueItems: [],
      restartLog: emptyLog,
      now: NOW,
    });
    expect(s.weights).toEqual(WORKER_HEALTH_CONFIG.weights);
  });
});

describe('getWorkerHealth', () => {
  test('empty database yields a full series with no detection', async () => {
    const res = await getWorkerHealth({ now: NOW, restartLog: emptyLog });
    expect(res.points).toHaveLength(WORKER_HEALTH_CONFIG.displayHours);
    expect(res.detection.run.fired).toBe(false);
    expect(res.detection.periodicity.fired).toBe(false);
    expect(executionFindMany).toHaveBeenCalledTimes(1);
  });
});
