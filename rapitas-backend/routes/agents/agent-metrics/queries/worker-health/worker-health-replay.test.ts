/**
 * worker-health-replay test
 *
 * Replays synthetic history through the real pipeline to MEASURE (acceptance
 * criterion 5) the false-positive rate on a healthy series and the detection
 * delay after an injected failure. Production data is deliberately not used.
 *
 * Evaluation is point-in-time: composite[i] depends only on data up to bucket
 * i, so "would the run rule have fired at i" is read off the prefix.
 */
import { describe, test, expect, mock } from 'bun:test';

mock.module('../../../../../config/database', () => ({ prisma: {} }));

import {
  buildWorkerHealthSeries,
  type WorkerHealthExecutionRow,
  type WorkerHealthQueueRow,
} from './worker-health-query';
import { detectRun } from './worker-health-detector';
import { WORKER_HEALTH_CONFIG, WORKER_HEALTH_UNITS } from './worker-health-config';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-12T00:00:00.000Z');
const HISTORY_HOURS = WORKER_HEALTH_CONFIG.displayHours + 4 * 7 * 24;
const START = NOW.getTime() - HISTORY_HOURS * HOUR;

/** Deterministic LCG in [0,1). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function synthesize(injectFromHour: number | null) {
  const rand = rng(42);
  const executions: WorkerHealthExecutionRow[] = [];
  const queueItems: WorkerHealthQueueRow[] = [];
  for (let h = 0; h < HISTORY_HOURS; h++) {
    const hourOfDay = new Date(START + h * HOUR).getUTCHours();
    // Daily rhythm: busy 08-20 UTC, quiet at night.
    const base = hourOfDay >= 8 && hourOfDay < 20 ? 12 : 3;
    const n = Math.max(0, Math.round(base + (rand() - 0.5) * 4));
    const injected = injectFromHour !== null && h >= injectFromHour;
    for (let i = 0; i < n; i++) {
      const completedAt = new Date(START + h * HOUR + Math.floor(rand() * HOUR));
      if (injected) {
        // Failure mode: everything times out; most items need a retry.
        if (rand() < 0.2) {
          executions.push({ status: 'completed', completedAt, errorMessage: null });
        } else {
          executions.push({ status: 'failed', completedAt, errorMessage: 'CLI timeout' });
        }
        queueItems.push({ status: 'failed', retryCount: rand() < 0.7 ? 2 : 0, completedAt });
      } else {
        const failed = rand() < 0.04;
        executions.push({
          status: failed ? 'failed' : 'completed',
          completedAt,
          errorMessage: failed ? (rand() < 0.5 ? 'timeout' : 'boom') : null,
        });
        queueItems.push({ status: 'completed', retryCount: rand() < 0.05 ? 1 : 0, completedAt });
      }
    }
  }
  return { executions, queueItems };
}

const restartLog = { recordingStartedAt: new Date(START - 1000 * HOUR), restarts: [] as Date[] };

/** Evaluate the run rule at every point; returns indexes where it fires "now". */
function firingIndexes(composite: Array<number | null>): number[] {
  const out: number[] = [];
  for (let i = 0; i < composite.length; i++) {
    const r = detectRun(
      composite.slice(0, i + 1),
      WORKER_HEALTH_CONFIG.runThreshold,
      WORKER_HEALTH_CONFIG.runLength,
    );
    if (r.fired && r.endIndex === i) out.push(i);
  }
  return out;
}

describe('first phase scope', () => {
  test('is limited to a single unit', () => {
    expect(WORKER_HEALTH_UNITS).toHaveLength(1);
  });
});

describe('replay measurement', () => {
  test('false-positive rate on a healthy series stays low', () => {
    const { executions, queueItems } = synthesize(null);
    const s = buildWorkerHealthSeries({ executions, queueItems, restartLog, now: NOW });
    const composite = s.points.map((p) => p.composite);
    const evaluated = composite.filter((c) => c !== null).length;
    const fp = firingIndexes(composite).length;
    const rate = fp / evaluated;
    // Measured value is printed so verify can record it.
    console.log(
      `[worker-health replay] false-positive rate = ${fp}/${evaluated} = ${rate.toFixed(4)}`,
    );
    expect(evaluated).toBe(WORKER_HEALTH_CONFIG.displayHours);
    expect(rate).toBeLessThanOrEqual(0.05);
  });

  test('detects an injected failure within the run length', () => {
    const injectAtPoint = WORKER_HEALTH_CONFIG.displayHours - 24; // last 24h degraded
    const injectFromHour = HISTORY_HOURS - 24;
    const { executions, queueItems } = synthesize(injectFromHour);
    const s = buildWorkerHealthSeries({ executions, queueItems, restartLog, now: NOW });
    const composite = s.points.map((p) => p.composite);
    const fired = firingIndexes(composite).filter((i) => i >= injectAtPoint);
    expect(fired.length).toBeGreaterThan(0);
    const delayBuckets = fired[0] - injectAtPoint;
    console.log(`[worker-health replay] detection delay = ${delayBuckets} buckets after injection`);
    // First possible fire is runLength-1 buckets after onset.
    expect(delayBuckets).toBeGreaterThanOrEqual(WORKER_HEALTH_CONFIG.runLength - 1);
    expect(delayBuckets).toBeLessThanOrEqual(WORKER_HEALTH_CONFIG.runLength + 1);
  });
});
