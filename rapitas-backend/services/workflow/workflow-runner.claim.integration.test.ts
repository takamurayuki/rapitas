/**
 * workflow-runner.claim.integration.test
 *
 * Task 1568 against a REAL SQLite database: the runner's claim is fail-closed (a claim that
 * cannot be made never lets advance or updateStatus run), its short writes happen in the claim's
 * own transaction, a shutdown never rewrites a handed-back item, and a red CI repair item is run
 * exactly once while the other theme task keeps running.
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
  return { success: true, role: 'implementer', status: 'verify_done', skipped: false };
});
mock.module('./workflow-orchestrator', () => ({
  WorkflowOrchestrator: { getInstance: () => ({ advanceWorkflow: advanceWorkflowMock }) },
}));

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
const merged = () =>
  db.task.update({ where: { id: taskId }, data: { status: 'done', workflowStatus: 'completed' } });

async function runRunner(): Promise<void> {
  const runner = WorkflowRunner.getInstance() as unknown as {
    executeWorkflowItem(item: unknown): Promise<void>;
  };
  await runner.executeWorkflowItem(mapToQueueItem(await itemRow()));
}

const breakItemUpdates = () =>
  db.$executeRawUnsafe(
    "CREATE TRIGGER fail_item_update BEFORE UPDATE ON WorkflowQueueItem BEGIN SELECT RAISE(ABORT, 'SQLITE_BUSY simulated'); END;",
  );
const restoreItemUpdates = () => db.$executeRawUnsafe('DROP TRIGGER fail_item_update');

describe('the claim is fail-closed', () => {
  test('a claim that cannot be written: no advance, the item is left exactly as it was', async () => {
    await db.task.update({ where: { id: taskId }, data: { workflowStatus: 'implement' } });
    await breakItemUpdates();
    try {
      await runRunner();
    } finally {
      await restoreItemUpdates();
    }
    expect(advanceWorkflowMock).not.toHaveBeenCalled();
    expect(await itemRow()).toMatchObject({ status: 'running', currentPhase: 'ci_wait' });
  });

  test('a claim that cannot be written: the item is not completed either (wait, then green)', async () => {
    const running = runRunner();
    await new Promise((r) => setTimeout(r, 200));
    await breakItemUpdates();
    try {
      await merged();
      await running;
    } finally {
      await restoreItemUpdates();
    }
    expect(await itemRow()).toMatchObject({ status: 'running' });
    expect(advanceWorkflowMock).not.toHaveBeenCalled();
  }, 15000);
});

describe('short writes live inside the claim transaction', () => {
  test('a progress write after a re-hold keeps the CI-wait phase', async () => {
    const { guardQueueWrites } = await import('./workflow-runner-item-claim');
    const queue = guardQueueWrites({} as never, itemId, taskId, () => 'verify_done');
    await queue.updateStatus(itemId, 'running', { currentPhase: 'verify_done' });
    expect(await itemRow()).toMatchObject({ status: 'running', currentPhase: 'ci_wait' });
  });

  test('a claimed write lands in the same transaction: phase and status move together', async () => {
    const { guardQueueWrites } = await import('./workflow-runner-item-claim');
    const queue = guardQueueWrites({} as never, itemId, taskId, () => 'implement');
    await queue.updateStatus(itemId, 'completed', { currentPhase: 'completed' });
    expect(await itemRow()).toMatchObject({ status: 'completed', currentPhase: 'completed' });
  });

  test('a write that fails rolls the claim back with it', async () => {
    const { claimQueueItem } = await import('./workflow-runner-item-claim');
    await expect(
      claimQueueItem(itemId, taskId, 'implement', false, async () => {
        throw new Error('write rejected');
      }),
    ).rejects.toThrow('write rejected');
    expect(await itemRow()).toMatchObject({ status: 'running', currentPhase: 'ci_wait' });
  });
});

describe('shutdown', () => {
  const stopWith = async (): Promise<void> => {
    const runner = WorkflowRunner.getInstance() as unknown as {
      running: boolean;
      activeExecutions: Map<number, unknown>;
      stopProcessing(): Promise<void>;
    };
    runner.running = true;
    runner.activeExecutions.set(itemId, {
      queueItemId: itemId,
      taskId,
      startedAt: new Date(),
      currentPhase: 'verify_done',
      abortController: new AbortController(),
    });
    await runner.stopProcessing();
  };

  test('a handed-back (completed) item is not put back in the queue', async () => {
    await handBack();
    await stopWith();
    expect(await itemRow()).toMatchObject({ status: 'completed', currentPhase: 'awaiting_ci' });
  });

  test('control: a running item is returned to the queue as before', async () => {
    await stopWith();
    expect((await itemRow()).status).toBe('queued');
  });
});
