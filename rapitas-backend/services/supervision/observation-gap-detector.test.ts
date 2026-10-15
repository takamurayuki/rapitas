/**
 * observation-gap-detector tests
 *
 * Gap detection from persisted heartbeats: normal cadence, over/at threshold,
 * evidence-based stop reasons (unknown without evidence), and reconstruction of a
 * gap whose record write failed once the next heartbeat succeeds.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createTimelineFake } from './testing/timeline-fake';

const fake = createTimelineFake();
mock.module('../memory/timeline', () => fake.module);
mock.module('../../config/database', () => ({ prisma: {} }));

const detector = await import('./observation-gap-detector');

const T0 = new Date('2026-09-10T00:00:00Z').getTime();
const MIN = 60_000;

function heartbeat(minute: number, pid: number | null = 100): void {
  fake.seed({
    eventType: 'supervision_monitor_heartbeat',
    correlationId: 'supervision_monitor_backend',
    createdAt: new Date(T0 + minute * MIN),
    payload: {
      schemaVersion: 1,
      monitorId: 'backend',
      sourceKind: 'backend_timer',
      intervalMs: MIN,
      pid,
      status: 'alive',
    },
  });
}

beforeEach(() => {
  fake.rows.length = 0;
});

describe('detectAndRecordGap', () => {
  test('a healthy cadence records no gap', async () => {
    [0, 1, 2, 3].forEach((m) => heartbeat(m));
    const r = await detector.detectAndRecordGap();
    expect(r.gapDetected).toBe(false);
    expect(await detector.listObservationGaps(new Date(T0))).toEqual([]);
  });

  test('exactly the threshold (3 intervals) is not a gap; just over is', async () => {
    heartbeat(0);
    heartbeat(3);
    expect((await detector.detectAndRecordGap()).gapDetected).toBe(false);
    heartbeat(6.1);
    const r = await detector.detectAndRecordGap();
    expect(r.gapDetected).toBe(true);
    expect(r.recorded).toBe(1);
  });

  test('same pid with a long silence is heartbeat_stale, not restart', async () => {
    heartbeat(0, 100);
    heartbeat(120, 100);
    expect((await detector.detectAndRecordGap()).reasonKind).toBe('heartbeat_stale');
  });

  test('a pid change after downtime is reconstructed as backend_restart from the DB alone', async () => {
    heartbeat(0, 100);
    heartbeat(30, 200); // first sample of the restarted process
    const r = await detector.detectAndRecordGap();
    expect(r.reasonKind).toBe('backend_restart');
    const [gap] = await detector.listObservationGaps(new Date(T0));
    expect(gap.startAt).toBe(new Date(T0).toISOString());
    expect(gap.recoveredAt).toBe(new Date(T0 + 30 * MIN).toISOString());
  });

  test('silence length alone never asserts a stop cause: no pid evidence is unknown', async () => {
    heartbeat(0, null);
    heartbeat(600, null);
    expect((await detector.detectAndRecordGap()).reasonKind).toBe('unknown');
  });

  test('in-process write failures during the silence are named event_write_failure', async () => {
    heartbeat(0, 100);
    heartbeat(10, 100);
    const r = await detector.detectAndRecordGap('backend', [new Date(T0 + 5 * MIN)]);
    expect(r.reasonKind).toBe('event_write_failure');
  });

  test('a failed gap write is rebuilt and recorded after the next successful heartbeat', async () => {
    heartbeat(0, 100);
    heartbeat(20, 200);
    fake.failNextAppends(1, 'supervision_observation_gap');
    const failed = await detector.detectAndRecordGap();
    expect(failed.gapDetected).toBe(true);
    expect(failed.unrecorded).toBe(1);
    expect(await detector.listObservationGaps(new Date(T0))).toEqual([]);

    heartbeat(21, 200); // newest two samples no longer span the gap
    const rebuilt = await detector.detectAndRecordGap();
    expect(rebuilt.recorded).toBe(1);
    const gaps = await detector.listObservationGaps(new Date(T0));
    expect(gaps).toHaveLength(1);
    expect(gaps[0].reasonKind).toBe('backend_restart');

    heartbeat(22, 200);
    expect((await detector.detectAndRecordGap()).recorded).toBe(0);
    expect(await detector.listObservationGaps(new Date(T0))).toHaveLength(1);
  });
});

describe('sumGapMsWithin', () => {
  test('merges overlaps and clips to the window', () => {
    const total = detector.sumGapMsWithin(
      [
        { startAt: new Date(T0), endAt: new Date(T0 + 10 * MIN) },
        { startAt: new Date(T0 + 5 * MIN), endAt: new Date(T0 + 15 * MIN) },
        { startAt: new Date(T0 - 60 * MIN), endAt: new Date(T0 - 30 * MIN) },
      ],
      new Date(T0),
      new Date(T0 + 12 * MIN),
    );
    expect(total).toBe(12 * MIN);
  });
});
