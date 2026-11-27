/**
 * restart-wait.restore.test
 *
 * What the restore must respect (task 1562): only a complete saved set
 * (phase waiting / retry) restores anything; a failed resume is retried next
 * time; a theme the user paused or stopped is never woken, whichever side of
 * an interleaving it lands on; and a wait that begins during a dequeue is
 * serialized with it (nothing starts after the wait began).
 */
import { describe, test, expect, beforeEach, afterAll, mock } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalDataDir = process.env.RAPITAS_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), 'restart-restore-'));
process.env.RAPITAS_DATA_DIR = dataDir;
afterAll(() => {
  if (originalDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = originalDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

const events: Array<{ evt: string; fields: Record<string, unknown> }> = [];
// Every export: mock.module replaces the module process-wide.
mock.module('../../observability/cycle-event-logger', () => ({
  logCycleEvent: (evt: string, fields: Record<string, unknown> = {}) =>
    events.push({ evt, fields }),
  getCycleLogFilePath: () => '/tmp/fake-cycle.ndjson',
  _resetForTests: () => {},
}));

const { RESTART_WAIT_MAX_MS } = await import('./boundary-policy');
const { isRestartWaitActive, tickRestartWait, resetRestartWaitCache, expireRestartWaitIfStale } =
  await import('./restart-wait');
const { readRestartWaitState, writeRestartWaitState, removeThemeFromResumeSet } =
  await import('./restart-wait-store');
const { resumeThemesAfterRestart } = await import('./restart-resume');
const { dequeueAndStart } = await import('../../workflow/workflow-runner-dequeue-gate');
const { withRestartGate } = await import('./restart-gate');

const T0 = 1_800_000_000_000;
const idle = { enabled: false, status: 'idle', order: 'priority' };
const noop = async () => false;

beforeEach(() => {
  writeRestartWaitState({});
  resetRestartWaitCache();
  events.length = 0;
});

describe('which saved states restore anything (phase)', () => {
  const throwing = {
    findRun: async () => {
      throw new Error('must not be called');
    },
    start: async () => {
      throw new Error('must not be called');
    },
  };

  test('phase=collecting (died while collecting) restores nothing and clears the flag', async () => {
    writeRestartWaitState({ phase: 'collecting', waitStartedAt: T0, resumeThemeIds: [1, 2] });
    resetRestartWaitCache();
    expect(await resumeThemesAfterRestart(throwing)).toEqual({ resumed: [], skipped: [] });
    expect(readRestartWaitState()).toEqual({});
    expect(isRestartWaitActive(T0)).toBe(false);
  });

  test('a set without a phase (older data) restores nothing', async () => {
    writeRestartWaitState({ waitStartedAt: T0, resumeThemeIds: [1] });
    resetRestartWaitCache();
    expect(await resumeThemesAfterRestart(throwing)).toEqual({ resumed: [], skipped: [] });
    expect(readRestartWaitState()).toEqual({});
  });

  test('a broken saved file restores nothing', async () => {
    writeFileSync(join(dataDir, '.auto-restart-wait.json'), '{"phase":"waiting","resumeThemeIds"');
    resetRestartWaitCache();
    expect(await resumeThemesAfterRestart(throwing)).toEqual({ resumed: [], skipped: [] });
  });

  test('phase=waiting without a flag-bearing file state is not "active" (collecting never holds work)', () => {
    writeRestartWaitState({ phase: 'collecting', waitStartedAt: T0 });
    resetRestartWaitCache();
    expect(isRestartWaitActive(T0)).toBe(false);
  });

  test('a theme set that could not be collected means no wait begins and nothing is saved', async () => {
    await tickRestartWait({
      aheadCount: 1,
      changedPaths: ['rapitas-backend/prisma/schema/a.prisma'],
      lastRestartAt: 0,
      evaluate: noop,
      listRunningThemeIds: async () => {
        throw new Error('db down');
      },
      now: T0,
    });
    expect(isRestartWaitActive(T0)).toBe(false);
    expect(readRestartWaitState().phase).toBeUndefined();
    expect(events.some((e) => e.evt === 'restart.wait_started')).toBe(false);
  });
});

describe('restore keeps what failed and what the user decided', () => {
  test('failed resume → phase=retry with only the failed ids; the next start retries them', async () => {
    writeRestartWaitState({ phase: 'waiting', waitStartedAt: T0, resumeThemeIds: [1, 2] });
    resetRestartWaitCache();
    const first = await resumeThemesAfterRestart({
      findRun: async () => idle,
      start: async (id) => {
        if (id === 1) throw new Error('db down');
      },
    });
    expect(first.resumed).toEqual([2]);
    expect(readRestartWaitState()).toEqual({ phase: 'retry', resumeThemeIds: [1] });
    expect(isRestartWaitActive(T0)).toBe(false);

    const again = await resumeThemesAfterRestart({
      findRun: async () => idle,
      start: async () => {},
    });
    expect(again.resumed).toEqual([1]);
    expect(readRestartWaitState()).toEqual({});
  });

  test('a theme the user paused, or that is stopping, is never started by the restore', async () => {
    writeRestartWaitState({ phase: 'waiting', waitStartedAt: T0, resumeThemeIds: [1, 2, 3] });
    resetRestartWaitCache();
    const started: number[] = [];
    const statuses: Record<number, string> = { 1: 'paused_user', 2: 'stopping', 3: 'idle' };
    const result = await resumeThemesAfterRestart({
      findRun: async (id) => ({ enabled: id !== 3, status: statuses[id]!, order: 'priority' }),
      start: async (id) => {
        started.push(id);
      },
    });
    expect(started).toEqual([3]);
    expect(result.skipped).toEqual([1, 2]);
  });

  test('the saved set is fixed when the wait began: later idle themes do not erase it', async () => {
    await tickRestartWait({
      aheadCount: 1,
      changedPaths: ['rapitas-backend/prisma/schema/a.prisma'],
      lastRestartAt: 0,
      evaluate: noop,
      listRunningThemeIds: async () => [1, 49],
      now: T0,
    });
    expect(readRestartWaitState()).toMatchObject({ phase: 'waiting', resumeThemeIds: [1, 49] });
    // Nothing else rewrites the set before the restart.
    expect(readRestartWaitState().resumeThemeIds).toEqual([1, 49]);
    resetRestartWaitCache();
  });

  test('removeThemeFromResumeSet keeps the others and tolerates a missing or broken file', () => {
    writeRestartWaitState({ phase: 'waiting', waitStartedAt: T0, resumeThemeIds: [1, 2] });
    removeThemeFromResumeSet(1);
    expect(readRestartWaitState().resumeThemeIds).toEqual([2]);
    removeThemeFromResumeSet(99);
    expect(readRestartWaitState().resumeThemeIds).toEqual([2]);
    writeFileSync(join(dataDir, '.auto-restart-wait.json'), '{broken');
    expect(() => removeThemeFromResumeSet(2)).not.toThrow();
    expect(readRestartWaitState()).toEqual({});
  });
});

describe('stop and restore interleavings', () => {
  test('a stop queued behind the restore of theme 1 removes theme 49 before its turn: it is not started', async () => {
    writeRestartWaitState({ phase: 'waiting', waitStartedAt: T0, resumeThemeIds: [1, 49] });
    resetRestartWaitCache();
    const started: number[] = [];
    const resuming = resumeThemesAfterRestart({
      findRun: async () => idle,
      start: async (id) => {
        started.push(id);
      },
    });
    // Requested from outside the restore while it is mid-way (theme 1's section is queued/running).
    const stop = withRestartGate(async () => removeThemeFromResumeSet(49));
    const result = await resuming;
    await stop;
    expect(started).toEqual([1]);
    expect(result.resumed).toEqual([1]);
    expect(readRestartWaitState()).toEqual({});
  });

  test('a stop that runs first is respected; the other themes still come back', async () => {
    writeRestartWaitState({ phase: 'waiting', waitStartedAt: T0, resumeThemeIds: [1, 49] });
    removeThemeFromResumeSet(1);
    resetRestartWaitCache();
    const started: number[] = [];
    await resumeThemesAfterRestart({
      findRun: async () => idle,
      start: async (id) => {
        started.push(id);
      },
    });
    expect(started).toEqual([49]);
  });

  test('a stop that began before the wait collected themes cannot be re-added by it', async () => {
    // The stop holds the gate while it writes; the wait collects only afterwards.
    const order: string[] = [];
    let releaseStop: () => void = () => {};
    const stopHeld = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    const stop = withRestartGate(async () => {
      order.push('stop:begin');
      await stopHeld;
      order.push('stop:end');
    });
    const waiting = tickRestartWait({
      aheadCount: 1,
      changedPaths: ['rapitas-backend/prisma/schema/a.prisma'],
      lastRestartAt: 0,
      evaluate: noop,
      listRunningThemeIds: async () => {
        order.push('collect');
        return [49];
      },
      now: T0,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['stop:begin']);
    releaseStop();
    await stop;
    await waiting;
    expect(order).toEqual(['stop:begin', 'stop:end', 'collect']);
    resetRestartWaitCache();
  });
});

describe('beginWait is serialized with dequeue', () => {
  test('a wait that begins during a dequeue takes effect after it; nothing starts afterwards', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const queue = {
      dequeue: async () => {
        calls += 1;
        const n = calls;
        order.push(`dequeue${n}:begin`);
        if (n === 1) await hold;
        order.push(`dequeue${n}:end`);
        return { id: n } as never;
      },
    };
    const started: number[] = [];

    const first = dequeueAndStart(queue, (item) => {
      started.push(item.id);
      order.push('registered1');
    });
    const waiting = tickRestartWait({
      aheadCount: 1,
      changedPaths: ['rapitas-backend/prisma/schema/a.prisma'],
      lastRestartAt: 0,
      evaluate: noop,
      listRunningThemeIds: async () => {
        order.push('wait:saved');
        return [1];
      },
      now: T0,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(isRestartWaitActive(T0)).toBe(false); // held behind the dequeue in flight
    release();
    await first;
    await waiting;
    expect(isRestartWaitActive(T0)).toBe(true);

    const second = await dequeueAndStart(queue, (item) => started.push(item.id));
    expect(second).toBeNull();
    expect(started).toEqual([1]);
    expect(order).toEqual(['dequeue1:begin', 'dequeue1:end', 'registered1', 'wait:saved']);
    resetRestartWaitCache();
  });
});

describe('a wait that never resolves ends by itself', () => {
  test('after the ceiling it logs the end, resumes dispatch and discards the saved set', async () => {
    await tickRestartWait({
      aheadCount: 1,
      changedPaths: ['rapitas-backend/prisma/schema/a.prisma'],
      lastRestartAt: 0,
      evaluate: noop,
      listRunningThemeIds: async () => [1, 49],
      now: T0,
    });
    expect(expireRestartWaitIfStale(T0 + RESTART_WAIT_MAX_MS - 1)).toBe(false);
    expect(isRestartWaitActive(T0 + RESTART_WAIT_MAX_MS - 1)).toBe(true);

    expect(expireRestartWaitIfStale(T0 + RESTART_WAIT_MAX_MS)).toBe(true);
    const end = events.find((e) => e.evt === 'restart.wait_ended');
    expect(end?.fields).toEqual({ reason: 'timeout', waitedMs: RESTART_WAIT_MAX_MS });
    expect(isRestartWaitActive(T0 + RESTART_WAIT_MAX_MS)).toBe(false);
    expect(readRestartWaitState()).toEqual({});
  });
});
