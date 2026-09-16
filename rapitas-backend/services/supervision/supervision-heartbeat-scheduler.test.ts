/**
 * supervision-heartbeat-scheduler tests
 *
 * The scheduler must keep sampling through write failures (a crash would extend
 * the blackout it exists to detect) and ignore duplicate starts.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import { createTimelineFake } from './testing/timeline-fake';

const fake = createTimelineFake();
mock.module('../memory/timeline', () => fake.module);
mock.module('../../config/database', () => ({ prisma: {} }));
const refreshCalls: number[] = [];
mock.module('./acceptance-status-service', () => ({
  refreshAcceptanceSnapshot: async (o: { heartbeatIntervalMs: number }) => {
    refreshCalls.push(o.heartbeatIntervalMs);
    return null;
  },
}));

const { SupervisionHeartbeatScheduler, emitHeartbeat } =
  await import('./supervision-heartbeat-scheduler');

afterEach(() => {
  fake.rows.length = 0;
  refreshCalls.length = 0;
});

describe('SupervisionHeartbeatScheduler', () => {
  test('a duplicate start is ignored', () => {
    const s = new SupervisionHeartbeatScheduler();
    s.start(60_000);
    s.start(1_000);
    expect(s.getIsRunning()).toBe(true);
    s.stop();
    expect(s.getIsRunning()).toBe(false);
  });

  test('an appendEvent failure does not stop later cycles', async () => {
    const s = new SupervisionHeartbeatScheduler();
    fake.failNextAppends(1, 'supervision_monitor_heartbeat');
    await s.runOnce();
    await s.runOnce();
    const beats = fake.rows.filter((r) => r.eventType === 'supervision_monitor_heartbeat');
    expect(beats).toHaveLength(1);
    // Snapshot refresh runs on the first cycle even after a failed heartbeat.
    expect(refreshCalls.length).toBe(1);
  });

  test('emitHeartbeat records the process pid for restart evidence', async () => {
    expect(await emitHeartbeat(60_000)).toBe(true);
    const payload = JSON.parse(fake.rows[0].payload) as { pid: number; sourceKind: string };
    expect(payload.pid).toBe(process.pid);
    expect(payload.sourceKind).toBe('backend_timer');
  });
});
