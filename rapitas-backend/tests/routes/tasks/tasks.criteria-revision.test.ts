/**
 * tasks.criteria-revision.test
 *
 * PATCH /tasks/:id and the criteria revision (companion design 4.5), over
 * HTTP on a real SQLite database: an edit of goals / constraints /
 * acceptanceCriteria must name the revision it was based on — missing → 400,
 * stale → 409 criteria_changed_since, current → written — while a PATCH
 * without criteria (status, priority, …) still needs no revision.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import {
  installSqliteJuryHarness,
  seedJudgeableTask,
} from '../../../services/workflow/jury-review-run.sqlite.test-helpers';

const { db, dispose } = installSqliteJuryHarness();
const { Elysia } = await import('elysia');
const { errorHandler } = await import('../../../middleware/error-handler');
const { tasksRoutes } = await import('../../../routes/tasks/tasks');
const { computeCriteriaRevision } = await import('../../../services/task/task-criteria-revision');

afterAll(dispose);

const app = new Elysia().use(errorHandler).use(tasksRoutes);

async function patch(taskId: number, body: Record<string, unknown>) {
  const res = await app.handle(
    new Request(`http://localhost/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const OLD_CRITERIA = JSON.stringify(['キーワードで絞り込める', '0件のとき案内が出る']);
const NEXT = ['キーワードで絞り込める', '0件のとき案内が出る', '検索語が URL に残る'];

async function revisionOf(taskId: number): Promise<string> {
  return computeCriteriaRevision(await db.task.findUniqueOrThrow({ where: { id: taskId } }));
}

describe('PATCH /tasks/:id — criteria need expectedCriteriaRevision', () => {
  test('a criteria edit without a revision is refused with 400 and writes nothing', async () => {
    const taskId = await seedJudgeableTask(db);
    const r = await patch(taskId, { title: '別の題', acceptanceCriteria: NEXT });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('criteria_revision_required');
    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.acceptanceCriteria).toBe(OLD_CRITERIA);
    // The rest of the request is not applied either.
    expect(row.title).toBe('一覧に検索を足す');
  });

  test('goals or constraints alone also need the revision', async () => {
    const taskId = await seedJudgeableTask(db);
    expect((await patch(taskId, { goals: ['速く探せる'] })).status).toBe(400);
    expect((await patch(taskId, { constraints: ['API は変えない'] })).status).toBe(400);
    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.goals).toBe(JSON.stringify(['検索できる']));
    expect(row.constraints).toBe(JSON.stringify([]));
  });

  test('a stale revision is refused with 409 criteria_changed_since', async () => {
    const taskId = await seedJudgeableTask(db);
    const seen = await revisionOf(taskId);
    // Someone else changes the criteria after this client read them.
    const other = await patch(taskId, {
      goals: ['検索できる', '共有できる'],
      expectedCriteriaRevision: seen,
    });
    expect(other.status).toBe(200);

    const r = await patch(taskId, { acceptanceCriteria: NEXT, expectedCriteriaRevision: seen });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('criteria_changed_since');
    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.acceptanceCriteria).toBe(OLD_CRITERIA);
    expect(row.goals).toBe(JSON.stringify(['検索できる', '共有できる']));
  });

  test('the current revision writes the criteria and records the change', async () => {
    const taskId = await seedJudgeableTask(db);
    const r = await patch(taskId, {
      acceptanceCriteria: NEXT,
      expectedCriteriaRevision: await revisionOf(taskId),
    });
    expect(r.status).toBe(200);
    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.acceptanceCriteria).toBe(JSON.stringify(NEXT));
    const activity = await db.activityLog.findFirstOrThrow({
      where: { taskId, action: 'acceptance_criteria_changed' },
    });
    expect(JSON.parse(activity.metadata ?? '{}')).toMatchObject({
      actor: 'user:task_screen',
      after: NEXT,
    });
  });

  test('a PATCH without criteria still needs no revision', async () => {
    const taskId = await seedJudgeableTask(db);
    const r = await patch(taskId, { priority: 'high', title: '一覧に検索を足す（急ぎ）' });
    expect(r.status).toBe(200);
    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.priority).toBe('high');
    expect(row.title).toBe('一覧に検索を足す（急ぎ）');
    expect(row.acceptanceCriteria).toBe(OLD_CRITERIA);
  });
});
