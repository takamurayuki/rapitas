/**
 * awaiting-ci-acceptance.integration.test
 *
 * Task 1568 acceptance table, joined end to end against a REAL SQLite database with the real slot
 * release, real next-task selection, the real strict-overlap context and the real
 * ci-self-repair enqueue path:
 *
 *   1. A waits for CI, B does not overlap  → A leaves the slot and the items, B is selected
 *   2. B overlaps A's PR                   → B is NOT selected (a wait, not all_done)
 *   3. A's CI is green and A is merged     → A completes; the running B is untouched
 *   4. A's CI is red                       → one repair item is queued in the normal order; B keeps running
 *   +  crash between the commit and the slot release recovers on the next tick
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../../generated/prisma-sqlite';
import { SQLITE_INIT_SQL } from '../../../src/generated/sqlite-init-sql';
import { processGreenCandidate, merge } from '../auto-merge-watcher.sqlite-support';

const dir = mkdtempSync(join(tmpdir(), 'rapitas-ci-accept-'));
const dbPath = join(dir, 'test.db');
const init = new Database(dbPath);
init.exec(SQLITE_INIT_SQL);
init.close();
const db = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

const logs: string[] = [];
const logger = {
  info() {},
  debug() {},
  warn: (...a: unknown[]) => logs.push(`warn ${JSON.stringify(a)}`),
  error: (...a: unknown[]) => logs.push(`error ${JSON.stringify(a)}`),
};
mock.module('../../../config/database', () => ({ prisma: db }));
mock.module('../../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger,
  createLogger: () => logger,
}));
const realConfig = await import('../../../config');
mock.module('../../../config', () => ({ ...realConfig, prisma: db, createLogger: () => logger }));
mock.module('../../observability', () => ({
  logCycleEvent: () => {},
  getCycleLogFilePath: () => '',
}));
mock.module('./auto-run-lifecycle', () => ({ broadcastAutoRunUpdateImpl: () => {} }));
// gh is not available here: the open PR of A changes this one file.
mock.module('./open-pr-files-cache', () => ({
  getPrChangedFiles: async () => ['rapitas-backend/services/shared.ts'],
}));

// The real selection decides; the enqueue side is reduced to what the scheduler does with a hit:
// queue the task and make it the theme's running head. A miss is recorded as such.
const selections: Array<{ found: boolean; taskId?: number; reason?: string }> = [];
mock.module('./auto-run-advance-select', () => ({
  selectAndEnqueueNextTask: async (
    p: PrismaClient,
    themeId: number,
    order: 'priority' | 'created',
    globalActive: number,
  ) => {
    const { selectNextTask } = await import('./auto-run-selection');
    const { buildScopeOverlapContext } = await import('./auto-run-advance-scope');
    const scope = await buildScopeOverlapContext(p as never, themeId, [{ prNumber: 7 }]);
    const result = await selectNextTask(p as never, themeId, order, [], globalActive, null, scope);
    selections.push(result);
    if (!result.found) return;
    await db.workflowQueueItem.create({
      data: { taskId: result.taskId, themeId, status: 'running', currentPhase: 'draft' },
    });
    await db.themeAutoRun.updateMany({
      where: { themeId },
      data: { currentTaskId: result.taskId },
    });
  },
}));

const { releaseAwaitingCiSlot } = await import('./auto-run-release-awaiting-ci');
const { attemptCiRepair } = await import('../ci-self-repair');

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const HOLD = 'verify_awaiting_required_merge';
let themeId = 0;
let aId = 0;
let bId = 0;

async function plan(taskId: number, file: string): Promise<void> {
  const content = `# plan\n\`${file}\`\n`;
  await db.workflowFile.create({
    data: { taskId, fileType: 'plan', content, sha256: 'x', sizeBytes: content.length },
  });
}

beforeEach(async () => {
  logs.length = 0;
  selections.length = 0;
  merge.mockClear();
  await db.taskDeliverableCompletion.deleteMany();
  await db.workflowFile.deleteMany();
  await db.workflowQueueItem.deleteMany();
  await db.workflowTransition.deleteMany();
  await db.themeAutoRun.deleteMany();
  await db.task.deleteMany();
  await db.theme.deleteMany();
  themeId = (
    await db.theme.create({ data: { name: 't', isDevelopment: true, workingDirectory: '/x' } })
  ).id;
  // A: PR open, parked for the required merge; its item still running when the tick comes.
  aId = (
    await db.task.create({
      data: { title: 'A', themeId, status: 'in-progress', workflowStatus: 'verify_done' },
    })
  ).id;
  bId = (await db.task.create({ data: { title: 'B', themeId, status: 'todo' } })).id;
  await db.workflowTransition.create({
    data: {
      taskId: aId,
      fromStatus: 'verify_done',
      toStatus: 'verify_done',
      actor: 'system',
      cause: HOLD,
    },
  });
  await db.workflowQueueItem.create({
    data: { taskId: aId, themeId, status: 'running', currentPhase: 'ci_wait' },
  });
  await db.themeAutoRun.create({
    data: { themeId, enabled: true, status: 'running', currentTaskId: aId, processedCount: 5 },
  });
});

const tick = (hooks = {}) =>
  releaseAwaitingCiSlot(db as never, themeId, aId, 'priority', 1, new Map(), hooks);
const itemsOf = (taskId: number) =>
  db.workflowQueueItem.findMany({ where: { taskId }, orderBy: { id: 'asc' } });
const theme = () => db.themeAutoRun.findFirstOrThrow({ where: { themeId } });

describe('row 1 and 2: who is selected while A waits for CI', () => {
  test('CI待ち項目が消失しても重複候補Bを選ばない', async () => {
    await db.workflowQueueItem.deleteMany({ where: { taskId: aId } });
    await plan(bId, 'rapitas-backend/services/shared.ts');
    expect(await tick()).toBe(true);
    expect(selections[0]).toMatchObject({ found: false, reason: 'all_overlap_deferred' });
    expect(await itemsOf(bId)).toEqual([]);
  });

  test("row 1: B does not overlap A's PR → A leaves slot and items, B is selected and running", async () => {
    await plan(bId, 'rapitas-frontend/src/other.tsx');
    expect(await tick()).toBe(true);

    expect((await itemsOf(aId))[0]).toMatchObject({
      status: 'completed',
      currentPhase: 'awaiting_ci',
    });
    expect(selections).toHaveLength(1);
    expect(selections[0]).toMatchObject({ found: true, taskId: bId });
    expect((await theme()).currentTaskId).toBe(bId);
    expect((await theme()).processedCount).toBe(5); // nothing counted as finished
    expect((await itemsOf(bId))[0].status).toBe('running');
  });

  test("row 2: B overlaps A's PR → B is not selected; the theme waits (not all_done)", async () => {
    await plan(bId, 'rapitas-backend/services/shared.ts');
    expect(await tick()).toBe(true);

    expect(selections).toHaveLength(1);
    expect(selections[0]).toMatchObject({ found: false, reason: 'all_overlap_deferred' });
    expect(await itemsOf(bId)).toEqual([]);
    expect((await db.task.findUniqueOrThrow({ where: { id: bId } })).status).toBe('todo');
    expect((await theme()).currentTaskId).toBeNull();
  });

  test('row 2 control: without a CI wait the legacy fallback still starts the overlapping head', async () => {
    // A is merged long ago (no waiter): strict is off, the starvation guard picks B as before.
    await db.task.update({
      where: { id: aId },
      data: { status: 'done', workflowStatus: 'completed' },
    });
    await db.workflowQueueItem.updateMany({
      where: { taskId: aId },
      data: { status: 'completed' },
    });
    await plan(bId, 'rapitas-backend/services/shared.ts');
    const { selectAndEnqueueNextTask } = await import('./auto-run-advance-select');
    await selectAndEnqueueNextTask(db as never, themeId, 'priority', 0, new Map());
    expect(selections[0]).toMatchObject({ found: true, taskId: bId });
  });
});

describe('row 3 and 4: what happens to A after the hand-back', () => {
  test('row 3: A merges (watcher completes it) → A completed, the running B is untouched', async () => {
    await plan(bId, 'rapitas-frontend/src/other.tsx');
    await tick();
    const bItemBefore = (await itemsOf(bId))[0];

    const bTaskBefore = await db.task.findUniqueOrThrow({ where: { id: bId } });
    await processGreenCandidate(aId);
    expect(merge).toHaveBeenCalledTimes(1);
    // 同一候補の遅延した再処理でも、Task完了と記録は増えない。
    await processGreenCandidate(aId);
    expect(await db.taskDeliverableCompletion.count({ where: { taskId: aId } })).toBe(1);
    expect(
      await db.workflowTransition.count({ where: { taskId: aId, cause: 'auto_merged' } }),
    ).toBe(1);
    expect(await db.task.findUniqueOrThrow({ where: { id: bId } })).toEqual(bTaskBefore);
    const { releaseThemeSlot } = await import('./parallel/theme-active-set');
    expect(await releaseThemeSlot(db as never, themeId, aId, 'completed')).toBe('not_member');

    const row = await theme();
    expect(row.currentTaskId).toBe(bId);
    expect(row.processedCount).toBe(5);
    expect((await itemsOf(bId))[0]).toMatchObject({ id: bItemBefore.id, status: 'running' });
    expect((await db.task.findUniqueOrThrow({ where: { id: aId } })).status).toBe('done');
  });

  test('row 4: CI turns red → the REAL repair path queues exactly one item for A; B keeps running', async () => {
    await plan(bId, 'rapitas-frontend/src/other.tsx');
    await tick();
    const bItemBefore = (await itemsOf(bId))[0];

    const res = await attemptCiRepair(aId, ['test (backend)'], 'boom');
    expect(res.bounced).toBe(true);

    const aItems = await itemsOf(aId);
    // The handed-back item stays completed/awaiting_ci; ONE new repair item carries the theme.
    expect(aItems.map((i) => [i.status, i.currentPhase === 'awaiting_ci'])).toEqual([
      ['completed', true],
      ['queued', false],
    ]);
    expect(aItems[1]).toMatchObject({ themeId, priority: 60 });
    expect((await itemsOf(bId))[0]).toMatchObject({ id: bItemBefore.id, status: 'running' });
    expect((await theme()).currentTaskId).toBe(bId);
  });

  test('row 4 (red before the tick): the repair finds the running item and queues nothing; the tick keeps the slot', async () => {
    await attemptCiRepair(aId, ['test (backend)'], 'boom');
    expect(await tick()).toBe(false); // A is no longer a CI wait: untouched
    expect(await itemsOf(aId)).toHaveLength(1);
    expect((await itemsOf(aId))[0].status).toBe('running');
    expect((await theme()).currentTaskId).toBe(aId);
  });
});

describe('recovery', () => {
  test('a crash between the commit and the slot release is repaired by the next tick', async () => {
    await plan(bId, 'rapitas-frontend/src/other.tsx');
    await expect(
      tick({
        afterCommit: async () => {
          throw new Error('process died after the commit');
        },
      }),
    ).rejects.toThrow('process died');

    // State left behind: the item is already handed back, the slot is still A's.
    expect((await itemsOf(aId))[0]).toMatchObject({
      status: 'completed',
      currentPhase: 'awaiting_ci',
    });
    expect((await theme()).currentTaskId).toBe(aId);
    expect(selections).toEqual([]);

    expect(await tick()).toBe(true); // next tick: nothing left to hand back, only the slot
    expect((await theme()).currentTaskId).toBe(bId);
    expect(selections).toHaveLength(1);
    expect(selections[0]).toMatchObject({ found: true, taskId: bId });
    expect(await itemsOf(aId)).toHaveLength(1); // still the one handed-back item
  });
});
