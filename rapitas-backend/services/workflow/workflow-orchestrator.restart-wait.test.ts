/**
 * workflow-orchestrator.restart-wait.test
 *
 * advanceWorkflow is the single door every phase start goes through (the runner, a delayed
 * re-dispatch, an auto-approve, an HTTP handler, the continuation after a phase). While a
 * restart wait is in force it must refuse the start without running any phase, remember the
 * task for replay, and otherwise register the advance in the ledger for exactly as long as it runs
 * (task 1562).
 */
import { describe, test, expect, beforeEach, afterAll, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalDataDir = process.env.RAPITAS_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), 'orchestrator-wait-'));
process.env.RAPITAS_DATA_DIR = dataDir;
afterAll(() => {
  if (originalDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = originalDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

const deferred = (ids: number[]) =>
  ids.map((taskId) => ({ taskId, themeId: null, workflowStatus: 'research_done' }));
const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('../../config', () => ({
  prisma: {
    task: { findUnique: async () => ({ workflowStatus: 'research_done' }) },
  },
  createLogger: () => noopLogger,
  logger: noopLogger,
  ensureDatabaseConnection: () => Promise.resolve(),
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => 'default',
  getProjectRoot: () => '/tmp/rapitas-test',
}));
mock.module('../observability/cycle-event-logger', () => ({
  logCycleEvent: () => {},
  getCycleLogFilePath: () => '/tmp/fake-cycle.ndjson',
  _resetForTests: () => {},
}));

const { WorkflowOrchestrator } = await import('./workflow-orchestrator');
const { writeRestartWaitState, readRestartWaitState } =
  await import('../scheduling/auto-restart-merged-code/restart-wait-store');
const { resetRestartWaitCache } =
  await import('../scheduling/auto-restart-merged-code/restart-wait');
const { getLedgerTaskIds, resetExecutionLedger } =
  await import('../scheduling/auto-restart-merged-code/execution-ledger');

type Admitted = (taskId: number, language: 'ja' | 'en') => Promise<unknown>;

/** Replace the advance proper so no phase (and no database) is involved. */
function stubAdvance(impl: Admitted): () => void {
  const proto = WorkflowOrchestrator.prototype as unknown as { advanceAdmitted: Admitted };
  const original = proto.advanceAdmitted;
  proto.advanceAdmitted = impl;
  return () => {
    proto.advanceAdmitted = original;
  };
}

function beginWait(): void {
  writeRestartWaitState({ phase: 'waiting', waitStartedAt: Date.now(), resumeThemeIds: [1] });
  resetRestartWaitCache();
}

beforeEach(() => {
  writeRestartWaitState({});
  resetRestartWaitCache();
  resetExecutionLedger();
});

describe('WorkflowOrchestrator.advanceWorkflow under a restart wait', () => {
  test('runnerの次フェーズが実入口を通り二重ロックせず開始する', async () => {
    const { startPhaseUnlessHalted } = await import('./workflow-runner-halt-guard');
    let phases = 0;
    const restore = stubAdvance(async () => {
      phases++;
      return { success: true };
    });
    try {
      const started = await startPhaseUnlessHalted(
        { updateStatus: async () => {} },
        { id: 1, taskId: 42 },
        'draft',
        () => {},
        async () => ({ completion: WorkflowOrchestrator.getInstance().advanceWorkflow(42) }),
      );
      await expect(started!.completion).resolves.toMatchObject({ success: true });
      expect(phases).toBe(1);
      expect(getLedgerTaskIds()).toEqual([]);
    } finally {
      restore();
    }
  });
  test('a refused advance runs no phase, is skipped, and the task is saved for replay', async () => {
    let phases = 0;
    const restore = stubAdvance(async () => {
      phases += 1;
      return { success: true };
    });
    try {
      beginWait();
      const result = await WorkflowOrchestrator.getInstance().advanceWorkflow(42, 'ja');
      expect(phases).toBe(0);
      expect(result.skipped).toBe(true);
      expect(result.success).toBe(true);
      expect(readRestartWaitState().deferredAdvance).toEqual(deferred([42]));
      expect(getLedgerTaskIds()).toEqual([]);
    } finally {
      restore();
    }
  });

  test('every direct caller is covered: refused starts of several tasks are all saved once', async () => {
    let phases = 0;
    const restore = stubAdvance(async () => {
      phases += 1;
      return { success: true };
    });
    try {
      beginWait();
      const orchestrator = WorkflowOrchestrator.getInstance();
      await Promise.all([
        orchestrator.advanceWorkflow(1, 'ja'),
        orchestrator.advanceWorkflow(2, 'ja'),
        orchestrator.advanceWorkflow(1, 'en'),
      ]);
      expect(phases).toBe(0);
      expect(readRestartWaitState().deferredAdvance?.sort()).toEqual(deferred([1, 2]));
    } finally {
      restore();
    }
  });

  test('without a wait the advance runs, and is in the ledger exactly while it runs', async () => {
    let seenDuring: number[] = [];
    const restore = stubAdvance(async () => {
      seenDuring = getLedgerTaskIds();
      return { success: true };
    });
    try {
      await WorkflowOrchestrator.getInstance().advanceWorkflow(7, 'ja');
      expect(seenDuring).toEqual([7]);
      expect(getLedgerTaskIds()).toEqual([]);
    } finally {
      restore();
    }
  });

  test('the ledger entry is released when the advance throws', async () => {
    const restore = stubAdvance(async () => {
      throw new Error('phase failed');
    });
    try {
      await expect(WorkflowOrchestrator.getInstance().advanceWorkflow(8, 'ja')).rejects.toThrow(
        'phase failed',
      );
      expect(getLedgerTaskIds()).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe('a delayed re-dispatch during a restart wait', () => {
  test('starts no phase and is saved for replay', async () => {
    let phases = 0;
    const restore = stubAdvance(async () => {
      phases += 1;
      return { success: true };
    });
    try {
      const { scheduleWorkflowRedispatch, REDISPATCH_DELAY_MS } =
        await import('./workflow-redispatch');
      beginWait();
      scheduleWorkflowRedispatch(77, 'plan_invalid_replan');
      await new Promise((r) => setTimeout(r, REDISPATCH_DELAY_MS + 300));
      expect(phases).toBe(0);
      expect(readRestartWaitState().deferredAdvance).toEqual(deferred([77]));
    } finally {
      restore();
    }
  });
});
