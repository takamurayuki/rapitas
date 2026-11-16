/**
 * workflow-handlers-resume.criteria-race.test
 *
 * Seeding an intake answer into goals against a goals edit that lands between
 * the handler's read and its write, on a real SQLite database (companion
 * design 4.5.1): the seeding is bound to the revision of that read, so the
 * edit is kept and only the seeding is dropped — the answer still reaches the
 * description.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  installSqliteJuryHarness,
  seedJudgeableTask,
} from '../../../services/workflow/jury-review-run.sqlite.test-helpers';

const { db, dispose } = installSqliteJuryHarness();

/** Lands right after the handler's first task read, if the test arms it. */
let afterFirstRead: (() => Promise<void>) | null = null;
const task = new Proxy(db.task, {
  get(target, prop, receiver) {
    if (prop !== 'findUnique') return Reflect.get(target, prop, receiver);
    return async (args: Parameters<typeof db.task.findUnique>[0]) => {
      const row = await target.findUnique(args);
      const hook = afterFirstRead;
      afterFirstRead = null;
      if (hook) await hook();
      return row;
    };
  },
});
const prisma = new Proxy(db, {
  get: (target, prop, receiver) => (prop === 'task' ? task : Reflect.get(target, prop, receiver)),
});
const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config', () => ({
  prisma,
  ensureDatabaseConnection: async () => {},
  createLogger: () => noop,
  logger: noop,
  getDbProvider: () => 'sqlite',
  getInsensitiveMode: () => undefined,
  getProjectRoot: () => process.cwd(),
}));
// Every export is mirrored (bun replaces the whole module); only the I/O is stubbed.
const files = { ...(await import('../../../services/workflow/workflow-file-utils')) };
mock.module('../../../services/workflow/workflow-file-utils', () => ({
  ...files,
  archiveWorkflowFile: async () => {},
  readWorkflowFile: async () => null,
  writeWorkflowFile: async () => '/wf/question.md',
}));
const recorder = { ...(await import('../../../services/workflow/transition-recorder')) };
mock.module('../../../services/workflow/transition-recorder', () => ({
  ...recorder,
  recordTransition: async () => {},
}));
const redispatch = { ...(await import('./workflow-handlers-resume-redispatch')) };
mock.module('./workflow-handlers-resume-redispatch', () => ({
  ...redispatch,
  triggerReExecutionAfterAnswer: async () => {},
}));

const { applyIntakeQuestionAnswerLocked } = await import('./workflow-handlers-resume');

afterAll(dispose);

const seedAsking = () =>
  seedJudgeableTask(db, { status: 'todo', workflowStatus: 'awaiting_question' });

const answer = (taskId: number) =>
  applyIntakeQuestionAnswerLocked({
    taskId,
    answer: '検索語は URL に残す',
    actor: 'user',
    sourceLabel: 'ユーザー選択',
  });

describe('answer seeding vs. a goals edit in between', () => {
  beforeEach(() => {
    afterFirstRead = null;
  });

  test('no edit in between → the answer is appended to goals', async () => {
    const taskId = await seedAsking();
    await answer(taskId);
    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.goals).toBe(JSON.stringify(['検索できる', '検索語は URL に残す']));
  });

  test('an edit after the read is kept; only the seeding is dropped', async () => {
    const taskId = await seedAsking();
    afterFirstRead = async () => {
      await db.task.update({
        where: { id: taskId },
        data: { goals: JSON.stringify(['人が書き直した目標']) },
      });
    };
    await answer(taskId);
    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.goals).toBe(JSON.stringify(['人が書き直した目標']));
    // The answer itself still lands.
    expect(row.description).toContain('検索語は URL に残す');
    expect(row.workflowStatus).toBe('draft');
  });
});
