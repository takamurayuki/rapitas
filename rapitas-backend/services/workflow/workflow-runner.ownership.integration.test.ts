/**
 * workflow-runner.ownership.integration.test
 *
 * Task 1568 against a REAL SQLite database: once the scheduler handed a queue item back for a CI
 * wait (`completed` + `awaiting_ci`), the runner that dequeued it must never touch the task or the
 * item again — no `advanceWorkflow`, no `updateStatus` — whatever happened next (the watcher
 * merged it: green; ci-self-repair sent it back to implement: red). Covered both inside the
 * verify_done wait and at the head of the outer loop, plus the write after a phase returns.
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
const sentToRepair = () =>
  db.task.update({ where: { id: taskId }, data: { workflowStatus: 'implement' } });

async function runRunner(): Promise<void> {
  const runner = WorkflowRunner.getInstance() as unknown as {
    executeWorkflowItem(item: unknown): Promise<void>;
  };
  await runner.executeWorkflowItem(mapToQueueItem(await itemRow()));
}

describe('inside the verify_done wait', () => {
  test('hand-back, then the watcher merged it (green): the runner leaves the item exactly as handed back', async () => {
    const running = runRunner();
    await new Promise((r) => setTimeout(r, 200)); // the runner is polling the settle wait
    await handBack();
    const handed = await itemRow();
    await merged();
    await running;

    const after = await itemRow();
    expect(after).toMatchObject({ status: 'completed', currentPhase: 'awaiting_ci' });
    expect(after.completedAt?.getTime()).toBe(handed.completedAt?.getTime()); // not rewritten
    expect(after.result).toBe(handed.result);
    expect(advanceWorkflowMock).not.toHaveBeenCalled();
  }, 15000);

  test('hand-back, then ci-self-repair sent it back to implement (red): the runner does not advance it', async () => {
    const running = runRunner();
    await new Promise((r) => setTimeout(r, 200));
    await handBack();
    await sentToRepair();
    await running;

    expect(await itemRow()).toMatchObject({ status: 'completed', currentPhase: 'awaiting_ci' });
    expect(advanceWorkflowMock).not.toHaveBeenCalled();
  }, 15000);
});

describe('at the head of the outer loop', () => {
  test('green: the item was handed back and the task merged before the pass starts', async () => {
    await handBack();
    const handed = await itemRow();
    await merged();
    await runRunner();

    const after = await itemRow();
    expect(after).toMatchObject({ status: 'completed', currentPhase: 'awaiting_ci' });
    expect(after.completedAt?.getTime()).toBe(handed.completedAt?.getTime());
    expect(advanceWorkflowMock).not.toHaveBeenCalled();
  });

  test('red: the item was handed back and the task went back to implement before the pass starts', async () => {
    await handBack();
    await sentToRepair();
    await runRunner();

    expect(await itemRow()).toMatchObject({ status: 'completed', currentPhase: 'awaiting_ci' });
    expect(advanceWorkflowMock).not.toHaveBeenCalled();
  });

  test('control: an item that is still ours is advanced as before', async () => {
    await db.task.update({ where: { id: taskId }, data: { workflowStatus: 'implement' } });
    await runRunner();
    expect(advanceWorkflowMock).toHaveBeenCalledTimes(1);
  });
});

describe('hand-back versus a runner that claims its item', () => {
  test('a hand-back that arrives while the runner is inside advance finds the item claimed: lost, nothing written', async () => {
    await db.task.update({ where: { id: taskId }, data: { workflowStatus: 'implement' } });
    let during: { result: string } | null = null;
    duringPhase = async () => {
      await db.task.update({
        where: { id: taskId },
        data: { status: 'in-progress', workflowStatus: 'verify_done' },
      });
      during = await handBackAwaitingCiItems(db as never, taskId, [itemId]);
      await merged(); // lets the loop finish on its next pass
    };
    await runRunner();
    expect(during).toEqual({ result: 'lost' });
    expect((await itemRow()).status).toBe('completed'); // closed by its own runner, not handed back
    expect((await itemRow()).currentPhase).not.toBe('awaiting_ci');
  });

  test('the claim goes first: the hand-back after it is lost; the claim after a hand-back is lost', async () => {
    const { claimQueueItem } = await import('./workflow-runner-item-claim');
    expect(await claimQueueItem(itemId, taskId, 'implement')).toBe('claimed');
    expect(await handBackAwaitingCiItems(db as never, taskId, [itemId])).toEqual({
      result: 'lost',
    });

    await db.workflowQueueItem.update({ where: { id: itemId }, data: { currentPhase: 'ci_wait' } });
    await handBack();
    expect(await claimQueueItem(itemId, taskId, 'implement')).toBe('lost');
    expect(await itemRow()).toMatchObject({ status: 'completed', currentPhase: 'awaiting_ci' });
  });

  test('a progress write keeps a CI-wait item in its phase instead of overwriting it', async () => {
    const { claimQueueItem } = await import('./workflow-runner-item-claim');
    expect(await claimQueueItem(itemId, taskId, null, true)).toBe('keep');
    expect((await itemRow()).currentPhase).toBe('ci_wait');
  });

  test('a missing item row is not ours (lost), never a free pass', async () => {
    const { claimQueueItem } = await import('./workflow-runner-item-claim');
    expect(await claimQueueItem(itemId + 999, taskId, 'implement')).toBe('lost');
  });
});

describe('holdForRequiredMerge puts the running item in the CI-wait phase (real SQLite)', () => {
  test('hold → item ci_wait → the hand-back completes it; a task that lost the hold CAS is left alone', async () => {
    const { holdForRequiredMerge } = await import('./required-merge-hold');
    const t = await db.task.create({
      data: { title: 'H', status: 'in-progress', workflowStatus: 'in_progress' },
    });
    const it = await db.workflowQueueItem.create({
      data: { taskId: t.id, status: 'running', currentPhase: 'verify', startedAt: new Date() },
    });
    expect(
      await holdForRequiredMerge({ taskId: t.id, fromStatus: 'in_progress', source: 'test' }),
    ).toBe(true);
    expect(
      (await db.workflowQueueItem.findUniqueOrThrow({ where: { id: it.id } })).currentPhase,
    ).toBe('ci_wait');
    expect(await handBackAwaitingCiItems(db as never, t.id, [it.id])).toEqual({
      result: 'released',
      count: 1,
    });

    const t2 = await db.task.create({
      data: { title: 'H2', status: 'done', workflowStatus: 'completed' },
    });
    const it2 = await db.workflowQueueItem.create({
      data: { taskId: t2.id, status: 'running', currentPhase: 'verify', startedAt: new Date() },
    });
    expect(
      await holdForRequiredMerge({ taskId: t2.id, fromStatus: 'in_progress', source: 'test' }),
    ).toBe(false);
    expect(
      (await db.workflowQueueItem.findUniqueOrThrow({ where: { id: it2.id } })).currentPhase,
    ).toBe('verify');
  });
});
