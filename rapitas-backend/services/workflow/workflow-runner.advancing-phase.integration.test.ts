/**
 * workflow-runner.advancing-phase.integration.test
 *
 * Task 1568 against a REAL SQLite database: while a runner advances a phase its item is held as
 * `advancing`, so another path's `holdForRequiredMerge` cannot move it into the CI-wait phase and
 * the scheduler cannot hand it back mid-advance; the runner itself hands the item over when the
 * advance ends with the task parked for CI. Also: a red CI repair is dequeued by the normal queue
 * and advanced exactly once while the other theme task is left untouched.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../generated/prisma-sqlite';
import { SQLITE_INIT_SQL } from '../../src/generated/sqlite-init-sql';

const dir = mkdtempSync(join(tmpdir(), 'rapitas-runner-own-'));
const dbPath = join(dir, 'test.db');
const init = new Database(dbPath);
init.exec(SQLITE_INIT_SQL);
init.close();
const db = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

const logger = { info() {}, debug() {}, warn() {}, error() {} };
mock.module('../../config/database', () => ({ prisma: db }));
mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger,
  createLogger: () => logger,
}));
const realConfig = await import('../../config');
mock.module('../../config', () => ({ ...realConfig, prisma: db, createLogger: () => logger }));

// The settle wait's lazy checks, none of which is under test here.
mock.module('./verify-settle-live-verifier', () => ({ isVerifierStillRunning: async () => false }));
mock.module('./verify-self-repair', () => ({ hasFreshVerifyRejection: async () => false }));
mock.module('./review-hold', () => ({ readReviewHold: async () => null }));
mock.module('./verify-settle-artifact-recovery', () => ({
  isAwaitingRequiredMerge: async () => false,
  hasConflictResolutionPending: async () => false,
  isAwaitingStagedPrCompletion: async () => false,
  recoverFromLandedArtifact: async () => false,
}));
mock.module('./workflow-runner-events', () => ({
  logPhaseTransition: async () => {},
  broadcastRunnerStatus: () => {},
  broadcastItemUpdate: () => {},
}));
mock.module('./subtask-completion-handler', () => ({
  onSubtaskCompleted: async () => {},
  isSubtaskFinished: () => true,
  isSubtaskFailed: () => false,
  isSubtaskPassed: () => true,
  isParentFinalizable: () => true,
}));
mock.module('../agents/stop-task-agents', () => ({
  stopTaskAgents: async () => ({ stoppedCount: 0, executionIds: [] }),
  stopThemeAgents: async () => ({ stoppedCount: 0, executionIds: [] }),
}));

// The orchestrator is the "advance": a spy that can run a side effect while a phase is "running".
let duringPhase: (() => Promise<void>) | null = null;
const advanceWorkflowMock = mock(async () => {
  if (duringPhase) await duringPhase();
  else
    await db.task.updateMany({ where: {}, data: { status: 'done', workflowStatus: 'completed' } });
  return { success: phaseSuccess, role: 'implementer', status: 'verify_done', skipped: false };
});
let phaseSuccess = true;
mock.module('./workflow-orchestrator', () => ({
  WorkflowOrchestrator: { getInstance: () => ({ advanceWorkflow: advanceWorkflowMock }) },
}));

const realGate = await import('./queue-provider-gate');
mock.module('./queue-provider-gate', () => ({ ...realGate, hasUsableProvider: async () => true }));

const { WorkflowRunner } = await import('./workflow-runner');
const { handBackAwaitingCiItems } = await import('./auto-run/awaiting-ci-release-txn');
const { mapToQueueItem } = await import('./queue-item-mapper');

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let taskId = 0;
let itemId = 0;

beforeEach(async () => {
  advanceWorkflowMock.mockClear();
  duringPhase = null;
  phaseSuccess = true;
  (WorkflowRunner as unknown as { instance: unknown }).instance = undefined;
  await db.workflowQueueItem.deleteMany();
  await db.workflowTransition.deleteMany();
  await db.task.deleteMany();
  taskId = (
    await db.task.create({
      data: { title: 'A', status: 'in-progress', workflowStatus: 'verify_done' },
    })
  ).id;
  await db.workflowTransition.create({
    data: {
      taskId,
      fromStatus: 'verify_done',
      toStatus: 'verify_done',
      actor: 'system',
      cause: 'verify_awaiting_required_merge',
    },
  });
  itemId = (
    await db.workflowQueueItem.create({
      data: { taskId, status: 'running', currentPhase: 'ci_wait', startedAt: new Date() },
    })
  ).id;
});

/** The scheduler's tick: hand the item back in one transaction (the real one). */
async function handBack(): Promise<void> {
  const res = await handBackAwaitingCiItems(db as never, taskId, [itemId]);
  expect(res.result).toBe('released');
}
const itemRow = () => db.workflowQueueItem.findUniqueOrThrow({ where: { id: itemId } });

async function runRunner(): Promise<void> {
  const runner = WorkflowRunner.getInstance() as unknown as {
    executeWorkflowItem(item: unknown): Promise<void>;
  };
  await runner.executeWorkflowItem(mapToQueueItem(await itemRow()));
}

const { holdForRequiredMerge } = await import('./required-merge-hold');
const { WorkflowQueueService } = await import('./workflow-queue');

const phaseOf = async (id: number) =>
  (await db.workflowQueueItem.findUniqueOrThrow({ where: { id } })).currentPhase;

async function until(cond: () => Promise<boolean>, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condition not met');
}

describe('F1: claim → another path holds → hand-back attempt → advance', () => {
  test.each(['例外', '失敗結果'])(
    'hold後の%sでもリトライせずCI待ちへ引き渡す',
    async (failure) => {
      await db.task.update({ where: { id: taskId }, data: { workflowStatus: 'implement' } });
      await db.workflowTransition.deleteMany();
      duringPhase = async () => {
        await holdForRequiredMerge({ taskId, fromStatus: 'implement', source: 'other-path' });
        if (failure === '例外') throw new Error('hold後に失敗');
        phaseSuccess = false;
      };
      await runRunner();
      expect(advanceWorkflowMock).toHaveBeenCalledTimes(1);
      expect(await itemRow()).toMatchObject({
        status: 'running',
        currentPhase: 'ci_wait',
        retryCount: 0,
      });
      expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).workflowStatus).toBe(
        'verify_done',
      );
      await handBack();
    },
    20000,
  );

  test('the hold cannot take the item, the hand-back finds nothing, and the runner hands it over after its own advance', async () => {
    await db.task.update({ where: { id: taskId }, data: { workflowStatus: 'implement' } });
    await db.workflowTransition.deleteMany();
    const seen: Record<string, unknown> = {};
    duringPhase = async () => {
      seen.phaseDuringAdvance = await phaseOf(itemId);
      // Another path parks the task for CI while this runner is inside its advance.
      expect(
        await holdForRequiredMerge({ taskId, fromStatus: 'implement', source: 'other-path' }),
      ).toBe(true);
      seen.phaseAfterHold = await phaseOf(itemId);
      seen.handBack = await handBackAwaitingCiItems(db as never, taskId, [itemId]);
    };
    const running = runRunner();
    await until(async () => seen.handBack !== undefined); // the advance has run its hold
    await until(async () => (await phaseOf(itemId)) === 'ci_wait'); // …and the runner handed over

    expect(advanceWorkflowMock).toHaveBeenCalledTimes(1);
    expect(seen).toEqual({
      phaseDuringAdvance: 'advancing',
      phaseAfterHold: 'advancing',
      handBack: { result: 'lost' },
    });
    // The advance is over: now (and only now) the scheduler can release the item.
    expect(await handBackAwaitingCiItems(db as never, taskId, [itemId])).toEqual({
      result: 'released',
      count: 1,
    });
    await running;
    expect(advanceWorkflowMock).toHaveBeenCalledTimes(1);
    expect(await itemRow()).toMatchObject({ status: 'completed', currentPhase: 'awaiting_ci' });
  }, 20000);
});

describe('F5: CI red — the repair item goes through the normal dequeue and runs once', () => {
  test('dequeue picks the themed repair item; the runner advances it once; B (item and task) is untouched', async () => {
    const theme = await db.theme.create({
      data: { name: 't', isDevelopment: true, workingDirectory: '/x' },
    });
    await db.task.update({ where: { id: taskId }, data: { themeId: theme.id } });
    await handBack();
    const b = await db.task.create({
      data: { title: 'B', themeId: theme.id, status: 'in-progress', workflowStatus: 'implement' },
    });
    const bItem = await db.workflowQueueItem.create({
      data: { taskId: b.id, themeId: theme.id, status: 'running', currentPhase: 'implement' },
    });
    const bTaskBefore = await db.task.findUniqueOrThrow({ where: { id: b.id } });
    const { attemptCiRepair } = await import('./ci-self-repair');
    expect((await attemptCiRepair(taskId, ['test (backend)'], 'boom')).bounced).toBe(true);

    // This one advance finishes ONLY the repair task (B's row is never written).
    duringPhase = async () => {
      await db.task.update({
        where: { id: taskId },
        data: { status: 'done', workflowStatus: 'completed' },
      });
    };
    const queue = WorkflowQueueService.getInstance();
    queue.setMaxConcurrency(5); // B already runs: the normal dequeue still has to offer the repair
    const dequeued = await queue.dequeue();
    expect(dequeued).toMatchObject({ taskId, priority: 60 });
    expect(dequeued!.id).not.toBe(itemId);
    expect(
      (await db.workflowQueueItem.findUniqueOrThrow({ where: { id: dequeued!.id } })).themeId,
    ).toBe(theme.id);
    expect(await queue.dequeue()).toBeNull(); // the repair is queued once, not twice

    const runner = WorkflowRunner.getInstance() as unknown as {
      executeWorkflowItem(item: unknown): Promise<void>;
    };
    const advanceBefore = advanceWorkflowMock.mock.calls.length;
    await runner.executeWorkflowItem(dequeued); // ends when the repaired task is seen completed
    expect(advanceWorkflowMock.mock.calls.length - advanceBefore).toBe(1);
    expect(await db.workflowQueueItem.findUniqueOrThrow({ where: { id: bItem.id } })).toMatchObject(
      {
        status: 'running',
        currentPhase: 'implement',
      },
    );
    const bTaskAfter = await db.task.findUniqueOrThrow({ where: { id: b.id } });
    expect([bTaskAfter.status, bTaskAfter.workflowStatus]).toEqual([
      bTaskBefore.status,
      bTaskBefore.workflowStatus,
    ]);
  }, 20000);
});
