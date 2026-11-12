/**
 * assistant-criteria.routes.test
 *
 * ラピ changing an existing task's completion criteria, end to end over HTTP
 * on a real SQLite database (companion design 段E, 4.2, 4.5, §7 stage 2):
 * draft → confirm → write, before/after + reason + confirmer kept, undo, the
 * repair window reset, and the 409s for a stale card, a stale undo, a review
 * in progress, a pending verdict, a held review and a done task.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import {
  installSqliteJuryHarness,
  seedJudgeableTask,
} from '../../services/workflow/jury-review-run.sqlite.test-helpers';

const { db, dispose } = installSqliteJuryHarness();
const { Elysia } = await import('elysia');
const { assistantCriteriaRoutes } = await import('./assistant-criteria.routes');
const { beginJuryRun, finishJuryRun } = await import('../../services/workflow/jury-review-run');

afterAll(dispose);

const app = new Elysia().use(assistantCriteriaRoutes);

async function post(path: string, body: unknown) {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const NEW = ['キーワードで絞り込める', '0件のとき案内が出る', '検索語が URL に残る'];

async function draft(taskId: number, acceptanceCriteria = NEW) {
  const r = await post('/assistant/criteria-draft', {
    taskId,
    acceptanceCriteria,
    reason: '共有リンクで検索結果を渡したいと言われた',
  });
  expect(r.status).toBe(200);
  return r.body.draft as {
    criteriaRevision: string;
    diff: { acceptanceCriteria: { added: string[]; removed: string[] } };
    blockedBy: string | null;
  };
}

const confirm = (taskId: number, expectedCriteriaRevision: string, acceptanceCriteria = NEW) =>
  post('/assistant/task-criteria', {
    taskId,
    confirmed: true,
    expectedCriteriaRevision,
    acceptanceCriteria,
    reason: '共有リンクで検索結果を渡したいと言われた',
  });

describe('draft → confirm → undo', () => {
  test('the change keeps before/after, reason and confirmer, resets the repair window, and can be undone', async () => {
    const taskId = await seedJudgeableTask(db);
    const d = await draft(taskId);
    expect(d.diff.acceptanceCriteria).toEqual({ added: ['検索語が URL に残る'], removed: [] });
    expect(d.blockedBy).toBeNull();
    // The draft wrote nothing.
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).acceptanceCriteria).toBe(
      JSON.stringify(['キーワードで絞り込める', '0件のとき案内が出る']),
    );

    const done = await confirm(taskId, d.criteriaRevision);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({
      success: true,
      previousRevision: d.criteriaRevision,
      confirmedBy: 'user',
      reason: '共有リンクで検索結果を渡したいと言われた',
    });
    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.acceptanceCriteria).toBe(JSON.stringify(NEW));

    const action = await db.assistantAction.findUniqueOrThrow({
      where: { id: done.body.actionId as number },
    });
    expect(action).toMatchObject({
      capabilityId: 'task.criteria-update',
      status: 'executed',
      taskId,
    });
    expect(JSON.parse(action.resultJson ?? '{}')).toMatchObject({
      before: { acceptanceCriteria: ['キーワードで絞り込める', '0件のとき案内が出る'] },
      after: { acceptanceCriteria: NEW },
      confirmedBy: 'user',
    });
    // The repair window's reset marker, with the before/after text (design 4.2).
    const activity = await db.activityLog.findFirstOrThrow({
      where: { taskId, action: 'acceptance_criteria_changed' },
    });
    expect(JSON.parse(activity.metadata ?? '{}')).toMatchObject({
      before: ['キーワードで絞り込める', '0件のとき案内が出る'],
      after: NEW,
    });

    const undo = await post('/assistant/task-criteria/revert', { actionId: done.body.actionId });
    expect(undo.status).toBe(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).acceptanceCriteria).toBe(
      JSON.stringify(['キーワードで絞り込める', '0件のとき案内が出る']),
    );
    expect(
      await db.activityLog.count({ where: { taskId, action: 'acceptance_criteria_changed' } }),
    ).toBe(2);
  });

  test('unconfirmed → 400 and a refused audit row', async () => {
    const taskId = await seedJudgeableTask(db);
    const d = await draft(taskId);
    const r = await post('/assistant/task-criteria', {
      taskId,
      confirmed: false,
      expectedCriteriaRevision: d.criteriaRevision,
      acceptanceCriteria: NEW,
      reason: 'x',
    });
    expect(r.status).toBe(400);
    expect(
      await db.assistantAction.count({
        where: { taskId, capabilityId: 'task.criteria-update', status: 'refused' },
      }),
    ).toBe(1);
  });
});

describe('409s', () => {
  test('a card built on an old revision → 409 criteria_changed_since', async () => {
    const taskId = await seedJudgeableTask(db);
    const d = await draft(taskId);
    await db.task.update({
      where: { id: taskId },
      data: { acceptanceCriteria: JSON.stringify(['画面から直した']) },
    });
    const r = await confirm(taskId, d.criteriaRevision);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('criteria_changed_since');
  });

  test('an undo after someone changed the criteria again → 409 criteria_changed_since', async () => {
    const taskId = await seedJudgeableTask(db);
    const d = await draft(taskId);
    const done = await confirm(taskId, d.criteriaRevision);
    await db.task.update({
      where: { id: taskId },
      data: { acceptanceCriteria: JSON.stringify(['その後の変更']) },
    });
    const undo = await post('/assistant/task-criteria/revert', { actionId: done.body.actionId });
    expect(undo.status).toBe(409);
    expect(undo.body.error).toBe('criteria_changed_since');
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).acceptanceCriteria).toBe(
      JSON.stringify(['その後の変更']),
    );
  });

  test('while the jury judges → 409 review_in_progress (the draft says so up front)', async () => {
    const taskId = await seedJudgeableTask(db);
    const before = await draft(taskId);
    const lock = await beginJuryRun({ taskId, source: 'http_save' });
    if (!lock.acquired) throw new Error('expected the lock');
    try {
      const d = await draft(taskId);
      expect(d.blockedBy).toBe('review_in_progress');
      const r = await confirm(taskId, before.criteriaRevision);
      expect(r.status).toBe(409);
      expect(r.body.error).toBe('review_in_progress');
    } finally {
      await finishJuryRun(lock.run, { status: 'applied' });
    }
  });

  for (const [name, over, code] of [
    ['verify_done', { workflowStatus: 'verify_done' }, 'review_in_progress'],
    [
      'a held review',
      { workflowStatus: 'verify_done', haltReason: 'awaiting_review_decision' },
      'review_in_progress',
    ],
    ['done', { status: 'done', workflowStatus: 'completed' }, 'task_done'],
  ] as const) {
    test(`${name} → 409 ${code}`, async () => {
      const taskId = await seedJudgeableTask(db, over);
      const d = await draft(taskId);
      const r = await confirm(taskId, d.criteriaRevision);
      expect(r.status).toBe(409);
      expect(r.body.error).toBe(code);
    });
  }
});
