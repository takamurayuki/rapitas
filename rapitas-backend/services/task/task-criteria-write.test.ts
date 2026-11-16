/**
 * task-criteria-write.test
 *
 * writeTaskCriteria on a real SQLite database (companion design 4.5, 4.5.1):
 * the optimistic revision check, the state rules (a)–(c) and `done`, the
 * discard-halt exception, and the acceptance_criteria_changed record that
 * resets the repair window.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import {
  installSqliteJuryHarness,
  seedJudgeableTask,
} from '../workflow/jury-review-run.sqlite.test-helpers';

const { db, dispose } = installSqliteJuryHarness();
const { writeTaskCriteria } = await import('./task-criteria-write');
const { computeCriteriaRevision } = await import('./task-criteria-revision');

afterAll(dispose);

type WriteDb = Parameters<typeof writeTaskCriteria>[0];
const writeDb = db as unknown as WriteDb;
const NEXT = ['キーワードで絞り込める', '検索語が URL に残る'];

const revisionOf = async (id: number) =>
  computeCriteriaRevision(await db.task.findUniqueOrThrow({ where: { id } }));

async function write(taskId: number, expected?: string) {
  return writeTaskCriteria(writeDb, {
    taskId,
    next: { acceptanceCriteria: NEXT },
    expectedCriteriaRevision: expected,
    actor: 'user:test',
    reason: '検索語を共有したい',
  });
}

describe('revision check', () => {
  test('a write built on an old revision → criteria_changed_since, nothing written', async () => {
    const taskId = await seedJudgeableTask(db);
    const stale = await revisionOf(taskId);
    await db.task.update({
      where: { id: taskId },
      data: { acceptanceCriteria: JSON.stringify(['別の人の変更']) },
    });
    const r = await write(taskId, stale);
    expect(r).toMatchObject({ ok: false, reason: 'criteria_changed_since' });
    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.acceptanceCriteria).toBe(JSON.stringify(['別の人の変更']));
  });

  test('the current revision → written; the revision moves; before/after and actor are recorded', async () => {
    const taskId = await seedJudgeableTask(db);
    const rev = await revisionOf(taskId);
    const r = await write(taskId, rev);
    if (!r.ok) throw new Error(`refused: ${r.reason}`);
    expect(r.previousRevision).toBe(rev);
    expect(r.revision).toBe(await revisionOf(taskId));
    expect(r.revision).not.toBe(rev);
    const log = await db.activityLog.findFirstOrThrow({
      where: { taskId, action: 'acceptance_criteria_changed' },
    });
    expect(JSON.parse(log.metadata ?? '{}')).toMatchObject({
      count: 2,
      before: ['キーワードで絞り込める', '0件のとき案内が出る'],
      after: NEXT,
      actor: 'user:test',
      reason: '検索語を共有したい',
      previousRevision: rev,
      revision: r.revision,
    });
  });

  test('whitespace-only differences do not change the revision', async () => {
    const a = computeCriteriaRevision({
      goals: '["g"]',
      constraints: null,
      acceptanceCriteria: '["a", "b"]',
    });
    const b = computeCriteriaRevision({
      goals: '[" g "]',
      constraints: '[]',
      acceptanceCriteria: '["a ", "  b"]',
    });
    expect(a).toBe(b);
    const reordered = computeCriteriaRevision({
      goals: '["g"]',
      constraints: null,
      acceptanceCriteria: '["b", "a"]',
    });
    expect(reordered).not.toBe(a);
  });
});

describe('when criteria may not change (409)', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    [
      '(a) verify_done — saved, the HTTP jury about to judge or judged',
      { workflowStatus: 'verify_done' },
      'review_in_progress',
    ],
    ['(a) completed', { workflowStatus: 'completed' }, 'review_in_progress'],
    ['(b) a jury holds the lock', { juryRunId: 999 }, 'review_in_progress'],
    [
      '(c) a review hold waits for a person',
      { workflowStatus: 'verify_done', haltReason: 'awaiting_review_decision' },
      'review_in_progress',
    ],
    // A hold always sits at verify_done, so (a) would also refuse it; this
    // row isolates (c) so dropping (c) alone still goes red.
    [
      '(c) a review hold, measured on its own (off verify_done)',
      { workflowStatus: 'in_progress', haltReason: 'awaiting_review_decision' },
      'review_in_progress',
    ],
    ['done', { status: 'done', workflowStatus: 'completed' }, 'task_done'],
  ];
  for (const [name, over, reason] of cases) {
    test(name, async () => {
      const taskId = await seedJudgeableTask(db, over);
      const before = await db.task.findUniqueOrThrow({ where: { id: taskId } });
      const r = await write(taskId, await revisionOf(taskId));
      expect(r).toMatchObject({ ok: false, reason });
      const after = await db.task.findUniqueOrThrow({ where: { id: taskId } });
      expect(after.acceptanceCriteria).toBe(before.acceptanceCriteria);
    });
  }

  test('halted with jury_result_discarded at verify_done → the change is allowed', async () => {
    const taskId = await seedJudgeableTask(db, {
      workflowStatus: 'verify_done',
      haltReason: 'jury_result_discarded',
    });
    const r = await write(taskId, await revisionOf(taskId));
    expect(r.ok).toBe(true);
  });

  test('a verify.md save that lands between the read and the write makes the write lose', async () => {
    const taskId = await seedJudgeableTask(db);
    const racing = new Proxy(writeDb, {
      get(target, prop) {
        if (prop !== 'task') return Reflect.get(target, prop);
        return {
          findUnique: (a: never) => target.task.findUnique(a),
          updateMany: async (a: Parameters<WriteDb['task']['updateMany']>[0]) => {
            await db.task.update({
              where: { id: taskId },
              data: { workflowStatus: 'verify_done' },
            });
            return target.task.updateMany(a);
          },
        };
      },
    });
    const r = await writeTaskCriteria(racing, {
      taskId,
      next: { acceptanceCriteria: NEXT },
      actor: 'test',
    });
    expect(r).toMatchObject({ ok: false, reason: 'review_in_progress' });
  });
});
