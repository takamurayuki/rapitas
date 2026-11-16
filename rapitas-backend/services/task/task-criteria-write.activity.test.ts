/**
 * task-criteria-write.activity.test
 *
 * The acceptance_criteria_changed record of writeTaskCriteria on a real
 * SQLite database (companion design 4.2, 段E): a change to ANY of the three
 * lists — goals or constraints alone included — leaves before/after, actor,
 * reason and both revisions, and resets the repair window; a write that
 * changes nothing records nothing.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import {
  installSqliteJuryHarness,
  seedJudgeableTask,
} from '../workflow/jury-review-run.sqlite.test-helpers';

const { db, dispose } = installSqliteJuryHarness();
const { writeTaskCriteria } = await import('./task-criteria-write');
const { computeCriteriaRevision } = await import('./task-criteria-revision');
const { countPriorRepairs } = await import('../workflow/verify-self-repair-budget');

afterAll(dispose);

type WriteDb = Parameters<typeof writeTaskCriteria>[0];
type Patch = Parameters<typeof writeTaskCriteria>[1]['next'];
const writeDb = db as unknown as WriteDb;

const revisionOf = async (id: number) =>
  computeCriteriaRevision(await db.task.findUniqueOrThrow({ where: { id } }));

async function write(taskId: number, next: Patch) {
  const r = await writeTaskCriteria(writeDb, {
    taskId,
    next,
    expectedCriteriaRevision: await revisionOf(taskId),
    actor: 'user:test',
    reason: '範囲を見直した',
  });
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r;
}

async function activities(taskId: number) {
  const rows = await db.activityLog.findMany({
    where: { taskId, action: 'acceptance_criteria_changed' },
    orderBy: { id: 'asc' },
  });
  return rows.map((row) => JSON.parse(row.metadata ?? '{}') as Record<string, unknown>);
}

/** Two repair bounces an hour ago — before any change below. */
async function seedRepairs(taskId: number) {
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  for (let i = 0; i < 2; i++) {
    await db.workflowTransition.create({
      data: {
        taskId,
        fromStatus: 'verify_done',
        toStatus: 'in_progress',
        actor: 'system',
        cause: 'verify_repair',
        createdAt: anHourAgo,
      },
    });
  }
}

describe('acceptance_criteria_changed covers all three lists', () => {
  test('goals alone: recorded with before/after, actor, reason, revisions; repair window reset', async () => {
    const taskId = await seedJudgeableTask(db);
    await seedRepairs(taskId);
    expect(await countPriorRepairs(taskId)).toBe(2);

    const r = await write(taskId, { goals: ['検索できる', '結果を共有できる'] });
    expect(r.changed).toBe(true);
    const [meta, ...rest] = await activities(taskId);
    expect(rest).toHaveLength(0);
    expect(meta).toMatchObject({
      actor: 'user:test',
      reason: '範囲を見直した',
      previousRevision: r.previousRevision,
      revision: r.revision,
      goals: { before: ['検索できる'], after: ['検索できる', '結果を共有できる'] },
      // The acceptance criteria did not move; both sides say so.
      before: ['キーワードで絞り込める', '0件のとき案内が出る'],
      after: ['キーワードで絞り込める', '0件のとき案内が出る'],
    });
    expect(meta).not.toHaveProperty('constraints');
    // The old bounces were judged against the old goals: the budget starts over.
    expect(await countPriorRepairs(taskId)).toBe(0);
  });

  test('constraints alone: recorded and the repair window reset', async () => {
    const taskId = await seedJudgeableTask(db);
    await seedRepairs(taskId);
    const r = await write(taskId, { constraints: ['API の形は変えない'] });
    const [meta] = await activities(taskId);
    expect(meta).toMatchObject({
      previousRevision: r.previousRevision,
      revision: r.revision,
      constraints: { before: [], after: ['API の形は変えない'] },
    });
    expect(meta).not.toHaveProperty('goals');
    expect(await countPriorRepairs(taskId)).toBe(0);
  });

  test('a write that changes nothing records nothing and keeps the window', async () => {
    const taskId = await seedJudgeableTask(db);
    await seedRepairs(taskId);
    const r = await write(taskId, { goals: ['検索できる'] });
    expect(r.changed).toBe(false);
    expect(await activities(taskId)).toHaveLength(0);
    expect(await countPriorRepairs(taskId)).toBe(2);
  });

  test('a whitespace-only rewrite is written but records nothing (same lists, same revision)', async () => {
    const taskId = await seedJudgeableTask(db);
    await seedRepairs(taskId);
    const r = await write(taskId, { goals: ['  検索できる  '] });
    expect(r.changed).toBe(true);
    expect(r.revision).toBe(r.previousRevision);
    expect(await activities(taskId)).toHaveLength(0);
    expect(await countPriorRepairs(taskId)).toBe(2);
  });

  test('putting goals back (an undo) is recorded too, with the revisions reversed', async () => {
    const taskId = await seedJudgeableTask(db);
    const first = await write(taskId, { goals: ['検索できる', '結果を共有できる'] });
    const back = await write(taskId, { goals: ['検索できる'] });
    expect(back.revision).toBe(first.previousRevision);
    const metas = await activities(taskId);
    expect(metas).toHaveLength(2);
    expect(metas[1]).toMatchObject({
      previousRevision: first.revision,
      revision: first.previousRevision,
      goals: { before: ['検索できる', '結果を共有できる'], after: ['検索できる'] },
    });
  });
});
