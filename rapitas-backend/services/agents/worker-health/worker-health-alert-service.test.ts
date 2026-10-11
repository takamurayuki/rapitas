/**
 * worker-health-alert-service unit tests
 *
 * Uses injected loader/notifier and a fixed clock: no DB, no timers.
 */
import { describe, test, expect, mock } from 'bun:test';

mock.module('../../../config/database', () => ({ prisma: {} }));
mock.module('../../communication/notification-service', () => ({
  createNotification: mock(() => Promise.resolve({})),
}));

import {
  createWorkerHealthAlertEvaluator,
  runWorkerHealthEvaluationTick,
  buildWorkerHealthLink,
} from './worker-health-alert-service';
import type {
  WorkerHealthPoint,
  WorkerHealthResult,
} from '../../../routes/agents/agent-metrics/queries/worker-health';
import { WORKER_HEALTH_CONFIG } from '../../../routes/agents/agent-metrics/queries/worker-health';

const NOW = new Date('2026-10-12T10:30:00.000Z');

function point(
  i: number,
  composite: number | null,
  z?: Partial<WorkerHealthPoint['z']>,
): WorkerHealthPoint {
  return {
    t: new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString(),
    raw: { completions: 0, timeoutRate: 0, retryRate: 0, restarts: 0 },
    z: { completions: 0, timeoutRate: 0, retryRate: 0, restarts: 0, ...z },
    composite,
  };
}

function result(
  composites: Array<number | null>,
  z?: Partial<WorkerHealthPoint['z']>,
): WorkerHealthResult {
  const points = composites.map((c, i) => point(i, c, c !== null && c >= 1.5 ? z : undefined));
  return {
    unit: 'worker',
    bucketMs: 3_600_000,
    generatedAt: NOW.toISOString(),
    recordingStartedAt: null,
    weights: { ...WORKER_HEALTH_CONFIG.weights },
    rules: { runThreshold: 1.5, runLength: 3, acfLowThreshold: 0.3, acfMinDrop: 0.4 },
    points,
    detection: {
      run: { fired: false, endIndex: -1 },
      periodicity: { fired: false, recent: null, previous: null },
    },
  } as WorkerHealthResult;
}

function withRun(r: WorkerHealthResult): WorkerHealthResult {
  const c = r.points.map((p) => p.composite);
  let run = 0;
  let end = -1;
  c.forEach((v, i) => {
    run = v !== null && v >= 1.5 ? run + 1 : 0;
    if (run >= 3) end = i;
  });
  r.detection.run = { fired: end >= 0, endIndex: end };
  return r;
}

describe('buildWorkerHealthLink', () => {
  test('deep-links to the metrics page panel with metric and time', () => {
    const link = buildWorkerHealthLink('timeoutRate', '2026-10-12T09:00:00.000Z');
    expect(link).toBe(
      '/agents/metrics?panel=worker-health&metric=timeoutRate&at=2026-10-12T09%3A00%3A00.000Z',
    );
  });
});

describe('evaluator', () => {
  test('notifies once for a run still open at the latest point, with the dominant metric', async () => {
    const notify = mock(() => Promise.resolve());
    const r = withRun(result([0, 0, 2, 2, 2], { timeoutRate: 4, completions: 0 }));
    const ev = createWorkerHealthAlertEvaluator({ loadResult: async () => r, notify });
    const first = await ev.evaluate(NOW);
    const second = await ev.evaluate(NOW);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: 'run', metric: 'timeoutRate' });
    expect(second).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(1);
    const arg = (notify.mock.calls[0] as unknown[])[0] as { link: string; message: string };
    expect(arg.link).toContain('panel=worker-health&metric=timeoutRate');
  });

  test('N-1 points does not notify', async () => {
    const notify = mock(() => Promise.resolve());
    const r = withRun(result([0, 0, 2, 2]));
    const ev = createWorkerHealthAlertEvaluator({ loadResult: async () => r, notify });
    expect(await ev.evaluate(NOW)).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });

  test('a run that already ended before the latest point is not alerted', async () => {
    const notify = mock(() => Promise.resolve());
    const r = withRun(result([2, 2, 2, 0, 0]));
    const ev = createWorkerHealthAlertEvaluator({ loadResult: async () => r, notify });
    expect(await ev.evaluate(NOW)).toHaveLength(0);
  });

  test('re-arms after the deviation resolves', async () => {
    const notify = mock(() => Promise.resolve());
    let current = withRun(result([0, 2, 2, 2]));
    const ev = createWorkerHealthAlertEvaluator({ loadResult: async () => current, notify });
    await ev.evaluate(NOW);
    current = withRun(result([0, 2, 2, 2, 0]));
    await ev.evaluate(NOW);
    current = withRun(result([0, 2, 2, 2, 0, 2, 2, 2]));
    expect(await ev.evaluate(NOW)).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  test('periodicity collapse raises its own episode', async () => {
    const notify = mock(() => Promise.resolve());
    const r = result([0.2, 0.3, 0.2, 0.9]);
    r.detection.periodicity = { fired: true, recent: 0.1, previous: 0.8 };
    const ev = createWorkerHealthAlertEvaluator({ loadResult: async () => r, notify });
    const fired = await ev.evaluate(NOW);
    expect(fired).toHaveLength(1);
    expect(fired[0].kind).toBe('periodicity');
  });

  test('pending (null) latest point never alerts', async () => {
    const notify = mock(() => Promise.resolve());
    const r = withRun(result([2, 2, 2, null]));
    const ev = createWorkerHealthAlertEvaluator({ loadResult: async () => r, notify });
    expect(await ev.evaluate(NOW)).toHaveLength(0);
  });
});

describe('runWorkerHealthEvaluationTick', () => {
  test('swallows evaluator errors so the next tick still runs', async () => {
    let calls = 0;
    const evaluator = {
      evaluate: mock(async () => {
        calls++;
        if (calls === 1) throw new Error('boom');
        return [];
      }),
    };
    await expect(runWorkerHealthEvaluationTick(evaluator, NOW)).resolves.toBeUndefined();
    await runWorkerHealthEvaluationTick(evaluator, NOW);
    expect(calls).toBe(2);
  });
});
