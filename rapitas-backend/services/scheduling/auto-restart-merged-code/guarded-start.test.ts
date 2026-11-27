/**
 * guarded-start.test
 *
 * The admission every new phase start passes through (task 1562): refused while a restart
 * wait is in force (and remembered), registered in the ledger otherwise, serialized with
 * the start of a wait, and replayed once dispatch is allowed again.
 */
import { describe, test, expect, beforeEach, afterAll, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalDataDir = process.env.RAPITAS_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), 'guarded-start-'));
process.env.RAPITAS_DATA_DIR = dataDir;
afterAll(() => {
  if (originalDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = originalDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

const events: Array<{ evt: string; fields: Record<string, unknown> }> = [];
mock.module('../../observability/cycle-event-logger', () => ({
  logCycleEvent: (evt: string, fields: Record<string, unknown> = {}) =>
    events.push({ evt, fields }),
  getCycleLogFilePath: () => '/tmp/fake-cycle.ndjson',
  _resetForTests: () => {},
}));

mock.module('../../../config', () => ({
  prisma: { task: { findUnique: async () => ({ themeId: null }) } },
}));
const deferred = (ids: number[]) => ids.map((taskId) => ({ taskId, themeId: null }));

const { admitAdvance, guardedStart, withAdmittedAdvance } = await import('./guarded-start');
const { LEDGER_ENTRY_MAX_AGE_MS, getLedgerTaskIds, registerExecution, resetExecutionLedger } =
  await import('./execution-ledger');
const { isRestartWaitActive, resetRestartWaitCache, tickRestartWait, endRestartWait } =
  await import('./restart-wait');
const { readRestartWaitState, writeRestartWaitState } = await import('./restart-wait-store');
const { replayDeferredAdvances } = await import('./deferred-advance');
const { resumeThemesAfterRestart } = await import('./restart-resume');

const T0 = 1_800_000_000_000;

function beginWait(extra: Record<string, unknown> = {}): void {
  writeRestartWaitState({ phase: 'waiting', waitStartedAt: T0, resumeThemeIds: [1], ...extra });
  resetRestartWaitCache();
}

beforeEach(() => {
  writeRestartWaitState({});
  resetRestartWaitCache();
  resetExecutionLedger();
  events.length = 0;
});

describe('admitAdvance', () => {
  test('runnerの待ちだけが終了しても引渡し済み実行の台帳は実行完了まで残る', async () => {
    let release!: () => void;
    const started = await guardedStart(
      () =>
        withAdmittedAdvance(5, async () => {
          release = (await admitAdvance(5))!.release;
          return { completion: Promise.resolve('runner待ち終了') };
        }),
      async () => null,
    );
    await started!.completion;
    try {
      expect(getLedgerTaskIds()).toEqual([5]);
    } finally {
      release();
    }
  });

  test('登録区間で使わなかった許可を遅延コールバックへ持ち越さない', async () => {
    let wake!: () => void;
    let delayed!: Promise<unknown>;
    const hold = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const started = await guardedStart(
      () =>
        withAdmittedAdvance(5, async () => {
          delayed = hold.then(() => admitAdvance(5));
          return { completion: Promise.resolve() };
        }),
      async () => null,
    );
    await started!.completion;
    beginWait();
    wake();
    expect(await delayed).toBeNull();
    expect(getLedgerTaskIds()).toEqual([]);
  });
  test('without a wait it grants the start and registers it until released', async () => {
    const admission = await admitAdvance(5);
    expect(admission).not.toBeNull();
    expect(getLedgerTaskIds()).toEqual([5]);
    admission!.release();
    admission!.release(); // idempotent
    expect(getLedgerTaskIds()).toEqual([]);
  });

  test('during a wait it refuses, registers nothing and saves the task once', async () => {
    beginWait();
    expect(await admitAdvance(5)).toBeNull();
    expect(await admitAdvance(5)).toBeNull();
    expect(await admitAdvance(6)).toBeNull();
    expect(getLedgerTaskIds()).toEqual([]);
    expect(readRestartWaitState().deferredAdvance).toEqual(deferred([5, 6]));
  });

  test('a wait that begins while an admission is queued refuses it (nothing starts after)', async () => {
    let releaseList: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const waiting = tickRestartWait({
      aheadCount: 1,
      changedPaths: ['rapitas-backend/prisma/schema/a.prisma'],
      lastRestartAt: 0,
      evaluate: async () => false,
      listRunningThemeIds: async () => {
        await hold;
        return [1];
      },
      now: T0,
    });
    await new Promise((r) => setTimeout(r, 10));
    const admitting = admitAdvance(9); // queued behind the wait's gate section
    releaseList();
    await waiting;
    expect(await admitting).toBeNull();
    expect(isRestartWaitActive(T0)).toBe(true);
    expect(getLedgerTaskIds()).toEqual([]);
    expect(readRestartWaitState().deferredAdvance).toEqual(deferred([9]));
    resetRestartWaitCache();
  });

  test('an admission granted before the wait began is still counted after it began', async () => {
    const admission = await admitAdvance(11);
    await tickRestartWait({
      aheadCount: 1,
      changedPaths: ['rapitas-backend/prisma/schema/a.prisma'],
      lastRestartAt: 0,
      evaluate: async () => false,
      listRunningThemeIds: async () => [1],
      now: T0,
    });
    expect(getLedgerTaskIds()).toEqual([11]); // the restart check keeps waiting for it
    admission!.release();
    expect(getLedgerTaskIds()).toEqual([]);
    resetRestartWaitCache();
  });
});

describe('execution ledger', () => {
  test('one id per task however many advances run, and a stale entry stops counting', () => {
    const a = registerExecution(1, 1000);
    registerExecution(1, 1000);
    registerExecution(2, 1000);
    expect(getLedgerTaskIds(1000).sort()).toEqual([1, 2]);
    expect(getLedgerTaskIds(1000 + LEDGER_ENTRY_MAX_AGE_MS)).toEqual([]);
    a();
    expect(getLedgerTaskIds(1000).sort()).toEqual([1, 2]);
  });
});

describe('replaying refused advances', () => {
  test('復元で失敗した保留advanceだけをretryに残して次回再試行する', async () => {
    beginWait({ deferredAdvance: deferred([51, 52]) });
    const deps = { findRun: async () => null, start: async () => {} };
    const advanced: number[] = [];
    await resumeThemesAfterRestart(deps, {
      shouldAdvance: async () => true,
      advance: async (id) => {
        if (id === 51) throw new Error('再開失敗');
        advanced.push(id);
      },
    });
    expect(readRestartWaitState()).toMatchObject({
      phase: 'retry',
      deferredAdvance: deferred([51]),
    });
    await resumeThemesAfterRestart(deps, {
      shouldAdvance: async () => true,
      advance: async (id) => {
        advanced.push(id);
      },
    });
    expect(advanced).toEqual([52, 51]);
    expect(readRestartWaitState()).toEqual({});
  });
  const allow = (advanced: number[]) => ({
    shouldAdvance: async () => true,
    advance: async (id: number) => {
      advanced.push(id);
    },
  });

  test('each task is advanced once; one that no longer needs it is skipped', async () => {
    const advanced: number[] = [];
    const done = await replayDeferredAdvances(deferred([1, 2, 2, 3]), {
      shouldAdvance: async (id) => id !== 2,
      advance: async (id) => {
        advanced.push(id);
      },
    });
    expect(done).toEqual([1, 3]);
    expect(advanced).toEqual([1, 3]);
  });

  test('a failing advance or check does not stop the others', async () => {
    const advanced: number[] = [];
    const done = await replayDeferredAdvances(deferred([1, 2, 3]), {
      shouldAdvance: async (id) => {
        if (id === 1) throw new Error('db down');
        return true;
      },
      advance: async (id) => {
        if (id === 2) throw new Error('boom');
        advanced.push(id);
      },
    });
    expect(done).toEqual([3]);
    expect(advanced).toEqual([3]);
  });

  test('nothing saved → nothing replayed', async () => {
    expect(await replayDeferredAdvances(undefined, allow([]))).toEqual([]);
  });

  test('when the wait ends without a restart, the refused advances are replayed', async () => {
    beginWait({ deferredAdvance: deferred([21, 22]) });
    const advanced: number[] = [];
    // endRestartWait replays through the real deps; swap the advance via the orchestrator mock.
    mock.module('../../workflow/workflow-orchestrator', () => ({
      WorkflowOrchestrator: {
        getInstance: () => ({ advanceWorkflow: async (id: number) => advanced.push(id) }),
      },
    }));
    mock.module('../../../config/database', () => ({
      prisma: {
        workflowQueueItem: { count: async () => 0 },
        task: { findUnique: async () => ({ themeId: null }) },
        themeAutoRun: { findFirst: async () => null },
      },
    }));
    expect(endRestartWait('nothing-ahead', T0 + 5_000)).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(advanced.sort()).toEqual([21, 22]);
    expect(readRestartWaitState()).toEqual({});
  });

  test('after a restart the restore replays them once the themes are back', async () => {
    beginWait({ deferredAdvance: deferred([31]) });
    const advanced: number[] = [];
    const result = await resumeThemesAfterRestart(
      {
        findRun: async () => ({ enabled: false, status: 'idle', order: 'priority' }),
        start: async () => {},
      },
      allowInto(advanced),
    );
    expect(result.resumed).toEqual([1]);
    expect(advanced).toEqual([31]);
    expect(readRestartWaitState()).toEqual({});
  });

  test('a replay after a restart is admitted: the wait flag is already lifted', async () => {
    beginWait({ deferredAdvance: deferred([41]) });
    let activeDuringReplay: boolean | null = null;
    await resumeThemesAfterRestart(
      {
        findRun: async () => ({ enabled: false, status: 'idle', order: 'priority' }),
        start: async () => {},
      },
      {
        shouldAdvance: async () => true,
        advance: async () => {
          activeDuringReplay = isRestartWaitActive();
        },
      },
    );
    expect(activeDuringReplay).toBe(false);
  });
});

function allowInto(advanced: number[]) {
  return {
    shouldAdvance: async () => true,
    advance: async (id: number) => {
      advanced.push(id);
    },
  };
}
