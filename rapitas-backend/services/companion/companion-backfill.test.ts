/**
 * companion-backfill tests (companion design 4.3, "既存のデータ")
 *
 * The one-off rows for tasks ラピ made before TaskCompanion existed:
 * task.create from its taskId column, roadmap.commit from resultJson.taskIds
 * whether it finished or stopped partway; done and deleted tasks left out; a
 * dry run writes nothing.
 */
import { describe, expect, test } from 'bun:test';
import {
  planCompanionBackfill,
  backfillCompanions,
  type BackfillActionRow,
  type BackfillDb,
} from './companion-backfill';

const ACTIONS: BackfillActionRow[] = [
  { id: 1, capabilityId: 'task.create', status: 'executed', taskId: 10, resultJson: '{"id":10}' },
  { id: 2, capabilityId: 'task.create', status: 'refused', taskId: null, resultJson: null },
  {
    id: 3,
    capabilityId: 'roadmap.commit',
    status: 'failed',
    taskId: null,
    resultJson: JSON.stringify({ taskIds: [20, 21], failedAfter: 2 }),
  },
  {
    id: 4,
    capabilityId: 'roadmap.commit',
    status: 'executed',
    taskId: null,
    resultJson: JSON.stringify({ taskIds: [30, 31, 32], failedAfter: null }),
  },
  {
    id: 5,
    capabilityId: 'roadmap.commit',
    status: 'executed',
    taskId: null,
    resultJson: 'not json',
  },
];

const STATUS = new Map([
  [10, 'todo'],
  [20, 'in-progress'],
  [21, 'todo'],
  [30, 'done'],
  [32, 'todo'],
]);

describe('planCompanionBackfill', () => {
  test('creates rows from both sources, skipping done, missing and tracked tasks', () => {
    const plan = planCompanionBackfill(ACTIONS, STATUS, new Set([32]));
    expect(plan.create).toEqual([
      { taskId: 10, origin: 'task_create', sourceActionId: 1 },
      { taskId: 20, origin: 'roadmap_commit', sourceActionId: 3 },
      { taskId: 21, origin: 'roadmap_commit', sourceActionId: 3 },
    ]);
    expect(plan.skipped).toEqual({ done: [30], missing: [31], alreadyTracked: [32] });
  });
});

function fakeDb(): BackfillDb & { writes: unknown[] } {
  const writes: unknown[] = [];
  return {
    writes,
    assistantAction: { findMany: async () => ACTIONS },
    task: {
      findMany: async ({ where }) =>
        where.id.in
          .filter((id) => STATUS.has(id))
          .map((id) => ({
            id,
            status: STATUS.get(id) as string,
            workspaceId: id === 10 ? 6 : null,
          })),
    },
    taskCompanion: {
      findMany: async () => [{ taskId: 32 }],
      create: async ({ data }) => {
        if (data.taskId === 21) throw new Error('unique constraint');
        writes.push(data);
        return data;
      },
    },
  };
}

describe('backfillCompanions', () => {
  test('a dry run reports the plan and writes nothing', async () => {
    const db = fakeDb();
    const out = await backfillCompanions(db, { apply: false });
    expect(out.create).toHaveLength(3);
    expect(out.created).toBe(0);
    expect(db.writes).toEqual([]);
  });

  test('apply writes row by row and reports the ones that failed', async () => {
    const db = fakeDb();
    const out = await backfillCompanions(db, { apply: true });
    expect(out.created).toBe(2);
    expect(out.failed).toEqual([21]);
    expect(db.writes).toHaveLength(2);
  });

  test('each row carries its task’s workspace (none in context while the script runs)', async () => {
    const db = fakeDb();
    await backfillCompanions(db, { apply: true });
    expect(db.writes[0]).toMatchObject({ taskId: 10, workspaceId: 6 });
    expect(db.writes[1]).not.toHaveProperty('workspaceId');
  });
});
