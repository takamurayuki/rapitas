/**
 * awaiting-ci-release-txn.interleave.test
 *
 * Task 1568 against a REAL SQLite database (production init SQL): the CI-wait hand-back is one
 * transaction, so ci-self-repair — which changes the task row first and looks for an existing
 * queue item second — can interleave at either end without losing its repair or double-queueing
 * it. Also covers the acceptance table end to end with the real slot release and real selection.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../../generated/prisma-sqlite';
import { SQLITE_INIT_SQL } from '../../../src/generated/sqlite-init-sql';

const dir = mkdtempSync(join(tmpdir(), 'rapitas-ci-wait-'));
const dbPath = join(dir, 'test.db');
const init = new Database(dbPath);
init.exec(SQLITE_INIT_SQL);
init.close();
const db = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

const warnings: string[] = [];
const logger = {
  info() {},
  warn: (...a: unknown[]) => warnings.push(JSON.stringify(a)),
  error: (...a: unknown[]) => warnings.push(JSON.stringify(a)),
  debug() {},
};
mock.module('../../../config', () => ({ prisma: db, createLogger: () => logger }));
mock.module('../../../config/database', () => ({ prisma: db }));
mock.module('../../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger,
  createLogger: () => logger,
}));
mock.module('../../observability', () => ({ logCycleEvent: () => {} }));
mock.module('./auto-run-lifecycle', () => ({ broadcastAutoRunUpdateImpl: () => {} }));

// Real next-task selection stands in for selectAndEnqueueNextTask's choice (its enqueue side needs
// the whole scheduler); the result is recorded so the table's "B is selected" row is checked.
const selections: Array<{ found: boolean; taskId?: number }> = [];
mock.module('./auto-run-advance-select', () => ({
  selectAndEnqueueNextTask: async (
    p: PrismaClient,
    themeId: number,
    order: 'priority' | 'created',
    globalActive: number,
  ) => {
    const { selectNextTask } = await import('./auto-run-selection');
    selections.push((await selectNextTask(p as never, themeId, order, [], globalActive)) as never);
  },
}));

const { releaseAwaitingCiSlot } = await import('./auto-run-release-awaiting-ci');

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const HOLD_CAUSE = 'verify_awaiting_required_merge';
let themeId = 0;
let aId = 0;
let bId = 0;
let aItemId = 0;

async function seedWaitingTask(): Promise<void> {
  await db.task.update({
    where: { id: aId },
    data: { status: 'in-progress', workflowStatus: 'verify_done' },
  });
  await db.workflowTransition.create({
    data: {
      taskId: aId,
      fromStatus: 'verify_done',
      toStatus: 'verify_done',
      actor: 'system',
      cause: HOLD_CAUSE,
    },
  });
  aItemId = (
    await db.workflowQueueItem.create({
      data: {
        taskId: aId,
        themeId,
        status: 'running',
        currentPhase: 'ci_wait',
        startedAt: new Date(),
      },
    })
  ).id;
  await db.themeAutoRun.updateMany({ where: { themeId }, data: { currentTaskId: aId } });
}

beforeEach(async () => {
  warnings.length = 0;
  selections.length = 0;
  await db.workflowQueueItem.deleteMany();
  await db.workflowTransition.deleteMany();
  await db.themeAutoRun.deleteMany();
  await db.task.deleteMany();
  await db.theme.deleteMany();
  themeId = (
    await db.theme.create({ data: { name: 't', isDevelopment: true, workingDirectory: '/x' } })
  ).id;
  // A: PR open, parked for the required merge, its queue item still running.
  aId = (await db.task.create({ data: { title: 'A', themeId, status: 'todo' } })).id;
  // B: an ordinary pending task.
  bId = (await db.task.create({ data: { title: 'B', themeId, status: 'todo' } })).id;
  await db.themeAutoRun.create({
    data: { themeId, enabled: true, status: 'running', currentTaskId: aId, processedCount: 3 },
  });
  await seedWaitingTask();
});

/**
 * ci-self-repair as it behaves at ci-self-repair.ts:264-296: change the task row FIRST, then queue
 * a repair item unless an active one already covers the run ("already in the queue").
 */
async function simulateCiRepair(taskId: number): Promise<void> {
  await db.task.update({
    where: { id: taskId },
    data: { status: 'in-progress', workflowStatus: 'implement', updatedAt: new Date() },
  });
  await db.workflowTransition.create({
    data: {
      taskId,
      fromStatus: 'verify_done',
      toStatus: 'implement',
      actor: 'system',
      cause: 'ci_repair',
    },
  });
  const active = await db.workflowQueueItem.findFirst({
    where: { taskId, status: { in: ['queued', 'running', 'waiting_approval'] } },
  });
  if (!active) {
    await db.workflowQueueItem.create({
      data: { taskId, themeId, priority: 60, status: 'queued' },
    });
  }
}

const run = (hooks = {}) =>
  releaseAwaitingCiSlot(db as never, themeId, aId, 'priority', 1, new Map(), hooks);
const items = (taskId: number) =>
  db.workflowQueueItem.findMany({ where: { taskId }, orderBy: { id: 'asc' } });
const theme = () => db.themeAutoRun.findFirstOrThrow({ where: { themeId } });

describe('acceptance table, end to end', () => {
  test('row 1: A waits for CI → A leaves the slot and the items, B is selected, nothing counted', async () => {
    expect(await run()).toBe(true);
    const row = await theme();
    expect(row.currentTaskId).toBeNull();
    expect(row.processedCount).toBe(3);
    const [aItem] = await items(aId);
    expect(aItem).toMatchObject({ status: 'completed', currentPhase: 'awaiting_ci' });
    expect(selections).toHaveLength(1);
    expect(selections[0]).toMatchObject({ found: true, taskId: bId });
  });

  test('the normal wait raises no WARN and no error log', async () => {
    await run();
    expect(warnings).toEqual([]);
  });

  test('row 3: A merged (done) before the tick → untouched; B is not affected', async () => {
    await db.task.update({
      where: { id: aId },
      data: { status: 'done', workflowStatus: 'completed' },
    });
    expect(await run()).toBe(false);
    expect((await theme()).currentTaskId).toBe(aId);
    expect((await items(aId))[0].status).toBe('running');
    expect((await db.task.findUniqueOrThrow({ where: { id: bId } })).status).toBe('todo');
  });

  test('a task parked for another reason (review hold) is not released', async () => {
    await db.workflowTransition.create({
      data: {
        taskId: aId,
        fromStatus: 'verify_done',
        toStatus: 'verify_done',
        actor: 'system',
        cause: 'review_hold',
      },
    });
    expect(await run()).toBe(false);
    expect((await theme()).currentTaskId).toBe(aId);
  });

  test('a second tick after the release changes nothing and selects nothing again', async () => {
    await run();
    selections.length = 0;
    // The slot is gone, so the scheduler no longer asks about A; asking anyway must be harmless.
    await run();
    expect(selections).toEqual([]);
    expect((await items(aId)).filter((i) => i.currentPhase === 'awaiting_ci')).toHaveLength(1);
  });
});

describe('interleaving with ci-self-repair', () => {
  test('(a) repair changes the task after the judgement, before the transaction: slot and item kept, one repair run', async () => {
    expect(await run({ afterRead: () => simulateCiRepair(aId) })).toBe(true);
    expect((await theme()).currentTaskId).toBe(aId); // slot kept
    const all = await items(aId);
    // The running item covers the repair (the repair saw it and queued nothing) and was NOT completed.
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: aItemId, status: 'running' });
    expect(selections).toEqual([]);
  });

  test('(b) repair changes the task right after the commit: the repair queues its own item, exactly one', async () => {
    expect(await run({ afterCommit: () => simulateCiRepair(aId) })).toBe(true);
    const all = await items(aId);
    expect(all.map((i) => [i.status, i.currentPhase])).toEqual([
      ['completed', 'awaiting_ci'],
      ['queued', 'draft'],
    ]);
    expect(all[1].id).not.toBe(aItemId); // the new repair item is untouched by the hand-back
  });

  test('(c) concurrent release and repair: whichever wins, exactly one active item remains for the repair', async () => {
    for (let i = 0; i < 5; i++) {
      await db.workflowQueueItem.deleteMany();
      await db.workflowTransition.deleteMany();
      await seedWaitingTask();
      await Promise.all([run(), simulateCiRepair(aId)]);
      const active = (await items(aId)).filter((x) => ['queued', 'running'].includes(x.status));
      expect(active).toHaveLength(1);
    }
  });

  test('a failed transaction keeps the slot and leaves the item running (no requeue)', async () => {
    await db.$executeRawUnsafe(
      "CREATE TRIGGER fail_item_update BEFORE UPDATE ON WorkflowQueueItem BEGIN SELECT RAISE(ABORT, 'SQLITE_BUSY simulated'); END;",
    );
    try {
      expect(await run()).toBe(true);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER fail_item_update');
    }
    expect((await theme()).currentTaskId).toBe(aId);
    expect((await items(aId))[0]).toMatchObject({ status: 'running', currentPhase: 'ci_wait' });
    expect(selections).toEqual([]);
  });
});
