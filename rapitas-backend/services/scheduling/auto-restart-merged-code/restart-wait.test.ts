/**
 * restart-wait.test
 *
 * The restart wait end to end, minus the process restart itself: two themes
 * alternate so "no running execution" never comes, merged code waits 30 min,
 * the wait starts, the restart gate then passes once the running work ends,
 * and after the (simulated) relaunch both themes are back to running exactly
 * once.
 */
import { describe, test, expect, beforeEach, afterAll, mock } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalDataDir = process.env.RAPITAS_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), 'restart-wait-'));
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

const { RESTART_WAIT_AFTER_MS, RESTART_WAIT_MAX_MS, decideBoundaryRestart, restartQueueDepth } =
  await import('./boundary-policy');
const { isRestartWaitActive, tickRestartWait, resetRestartWaitCache, endRestartWait } =
  await import('./restart-wait');
const { readRestartWaitState, writeRestartWaitState } = await import('./restart-wait-store');
const { resumeThemesAfterRestart } = await import('./restart-resume');

const T0 = 1_800_000_000_000;
const noopEvaluate = async () => false;

function tick(over: Partial<Parameters<typeof tickRestartWait>[0]>) {
  return tickRestartWait({
    aheadCount: 1,
    changedPaths: [],
    lastRestartAt: 0,
    evaluate: noopEvaluate,
    listRunningThemeIds: async () => [1, 49],
    now: T0,
    ...over,
  });
}

beforeEach(() => {
  writeRestartWaitState({});
  resetRestartWaitCache();
  events.length = 0;
});

describe('tickRestartWait', () => {
  test('nothing waiting → nothing happens', async () => {
    await tick({ aheadCount: 0 });
    expect(isRestartWaitActive(T0)).toBe(false);
    expect(readRestartWaitState()).toEqual({});
    expect(events).toEqual([]);
  });

  test('records when merged code first waited and never overwrites it', async () => {
    await tick({ now: T0 });
    await tick({ now: T0 + 5 * 60_000 });
    expect(readRestartWaitState().aheadSinceAt).toBe(T0);
    expect(isRestartWaitActive(T0 + 5 * 60_000)).toBe(false);
  });

  test('29 min does not enter the wait; 30 min does, with a cycle-log start record', async () => {
    await tick({ now: T0 });
    await tick({ now: T0 + RESTART_WAIT_AFTER_MS - 1 });
    expect(isRestartWaitActive(T0 + RESTART_WAIT_AFTER_MS - 1)).toBe(false);
    await tick({ now: T0 + RESTART_WAIT_AFTER_MS });
    expect(isRestartWaitActive(T0 + RESTART_WAIT_AFTER_MS)).toBe(true);
    expect(events.map((e) => e.evt)).toEqual(['restart.wait_started']);
    expect(events[0]!.fields.reason).toBe('ahead-too-long');
    resetRestartWaitCache();
  });

  test('a schema change enters the wait at once (both schema directories)', async () => {
    await tick({ changedPaths: ['prisma/schema.desktop/a.prisma'] });
    expect(isRestartWaitActive(T0)).toBe(true);
    expect(events[0]!.fields.reason).toBe('schema-change');
  });

  test('within 60 min of the last restart the wait is not entered', async () => {
    await tick({ changedPaths: ['prisma/schema/a.prisma'], lastRestartAt: T0 - 60_000 });
    expect(isRestartWaitActive(T0)).toBe(false);
  });

  test('ends when nothing is ahead any more and logs how long it waited', async () => {
    await tick({ changedPaths: ['prisma/schema/a.prisma'] });
    await tick({ aheadCount: 0, now: T0 + 90_000 });
    expect(isRestartWaitActive(T0 + 90_000)).toBe(false);
    const end = events.find((e) => e.evt === 'restart.wait_ended');
    expect(end?.fields).toEqual({ reason: 'nothing-ahead', waitedMs: 90_000 });
    expect(readRestartWaitState()).toEqual({});
  });

  test('a wait older than the ceiling no longer holds new work back', async () => {
    await tick({ changedPaths: ['prisma/schema/a.prisma'] });
    expect(isRestartWaitActive(T0 + RESTART_WAIT_MAX_MS - 1)).toBe(true);
    expect(isRestartWaitActive(T0 + RESTART_WAIT_MAX_MS)).toBe(false);
  });

  test('a corrupt state file reads as nothing saved', () => {
    writeFileSync(
      join(dataDir, '.auto-restart-wait.json'),
      '{"waitStartedAt":"x","resumeThemeIds":[1,"a",-2]',
    );
    resetRestartWaitCache();
    expect(readRestartWaitState()).toEqual({});
    expect(isRestartWaitActive(T0)).toBe(false);
  });
});

describe('two themes alternating → wait → restart gate → resume', () => {
  const quiet = {
    aheadCount: 3,
    isShuttingDown: false,
    runningExecutions: 0,
    auxChildren: 0,
    isMerging: false,
    msSinceLastRestart: null,
    minRestartIntervalMs: 3_600_000,
    msSinceLastUiActivity: null,
    uiQuietMs: 180_000,
    deferCount: 0,
    maxDeferrals: 5,
  };

  test('the restart goes through once the running work ends, and both themes come back', async () => {
    await tick({ now: T0 });
    await tick({ now: T0 + RESTART_WAIT_AFTER_MS });
    expect(isRestartWaitActive(T0 + RESTART_WAIT_AFTER_MS)).toBe(true);

    // While one execution still runs the gate waits; queued items (parked by the wait)
    // are not counted, so they cannot hold the restart.
    const queued = { queueDepth: 4, dispatchableQueueDepth: 0 };
    const depth = restartQueueDepth(queued);
    expect(decideBoundaryRestart({ ...quiet, activeExecutions: 1, queueDepth: depth }).reason).toBe(
      'active-executions',
    );
    expect(decideBoundaryRestart({ ...quiet, activeExecutions: 0, queueDepth: depth }).action).toBe(
      'restart',
    );

    // The themes that were running are what was saved at the wait start.
    expect(readRestartWaitState().resumeThemeIds).toEqual([1, 49]);

    // After the relaunch both themes are idle in the database.
    const status = new Map([
      [1, 'idle'],
      [49, 'idle'],
    ]);
    const started: number[] = [];
    const deps = {
      findRun: async (id: number) => ({
        enabled: false,
        status: status.get(id)!,
        order: 'priority',
      }),
      start: async (id: number) => {
        status.set(id, 'running');
        started.push(id);
      },
    };
    const first = await resumeThemesAfterRestart(deps);
    expect(first.resumed).toEqual([1, 49]);
    expect([...status.values()]).toEqual(['running', 'running']);
    expect(isRestartWaitActive(T0 + RESTART_WAIT_AFTER_MS)).toBe(false);
    expect(readRestartWaitState().waitStartedAt).toBeUndefined();
    const end = events.find((e) => e.evt === 'restart.wait_ended');
    expect(end?.fields.reason).toBe('restarted');
    expect(typeof end?.fields.waitedMs).toBe('number');

    // Idempotent: a second pass starts nothing.
    const second = await resumeThemesAfterRestart(deps);
    expect(second).toEqual({ resumed: [], skipped: [] });
    expect(started).toEqual([1, 49]);
  });

  test('a vanished or already-running theme is skipped; a failing one is kept for retry and does not stop the rest', async () => {
    writeRestartWaitState({ waitStartedAt: T0, phase: 'waiting', resumeThemeIds: [1, 2, 3, 4] });
    resetRestartWaitCache();
    const started: number[] = [];
    const result = await resumeThemesAfterRestart({
      findRun: async (id) => {
        if (id === 1) return null;
        if (id === 2) return { enabled: true, status: 'running', order: 'priority' };
        if (id === 3) throw new Error('db down');
        return { enabled: false, status: 'idle', order: 'created' };
      },
      start: async (id) => {
        started.push(id);
      },
    });
    expect(result.resumed).toEqual([4]);
    expect(result.skipped).toEqual([1, 2]);
    expect(started).toEqual([4]);
    expect(readRestartWaitState()).toEqual({ phase: 'retry', resumeThemeIds: [3] });
  });

  test('a boot with no saved wait changes nothing', async () => {
    const result = await resumeThemesAfterRestart({
      findRun: async () => {
        throw new Error('must not be called');
      },
      start: async () => {
        throw new Error('must not be called');
      },
    });
    expect(result).toEqual({ resumed: [], skipped: [] });
  });

  test('endRestartWait without a wait is a no-op (no log)', () => {
    endRestartWait('timeout');
    expect(events).toEqual([]);
  });
});
