/**
 * auto-merge-completion.deliverable.test
 *
 * The merge watcher's completion (CI green / merge success) is one of the
 * deliverable entry points (design §3.3, mode `ci_merge`): the `done` write
 * and the completion record are one transaction with one time. Before notes
 * stage 1 this path wrote `done` and nothing else. The guards are stubbed
 * (exports mirrored); the database is the in-memory stand-in.
 *
 * mock.module is process-global — run this file with --isolate.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { createStage1Db, type Stage1Db } from '../../tests/helpers/notes-stage1-db';

let db: Stage1Db = createStage1Db();
const prismaProxy = new Proxy({}, { get: (_t, key) => db.prisma[key as string] });
mock.module('../../config/database', () => ({
  prisma: prismaProxy,
  ensureDatabaseConnection: async () => {},
}));
mock.module('./auto-merge-task-guard', () => ({ canContinueAutoMerge: async () => true }));
mock.module('./verifier-completion-check', () => ({
  verifierConfirmedForCompletion: async () => true,
}));
mock.module('../../utils/ai-client', () => ({
  sendAIMessage: async () => ({ content: 'TITLE: 成果\nBODY:\n本文', tokensUsed: 0 }),
}));

const { completeTaskRow } = await import('./auto-merge-completion');

type Row = Record<string, unknown>;

beforeEach(() => {
  db = createStage1Db({
    task: [{ id: 5, status: 'in-progress', title: 'PR' }],
    workflowFile: [{ taskId: 5, fileType: 'verify', content: '確認した。'.repeat(60) }],
  });
});

describe('completeTaskRow as a deliverable entry (ci_merge)', () => {
  it('writes done and the record together, with one time', async () => {
    expect(await completeTaskRow(5)).toBe(true);
    const task = db.find('task', { id: 5 }) as Row;
    const record = db.find('taskDeliverableCompletion', { taskId: 5 }) as Row;
    expect(task).toMatchObject({ status: 'done', workflowStatus: 'completed' });
    expect(record).toMatchObject({ mode: 'ci_merge', state: 'pending' });
    expect((record.completedAt as Date).getTime()).toBe((task.updatedAt as Date).getTime());
    expect((task.completedAt as Date).getTime()).toBe((task.updatedAt as Date).getTime());
  });

  it('then creates the deliverable note in the background', async () => {
    await completeTaskRow(5);
    await new Promise((r) => setTimeout(r, 20));
    expect(db.find('note', { id: 'deliverable-task-5' })).toBeDefined();
  });

  it('reports false and leaves the task as it was when the record cannot be written', async () => {
    db.hooks.beforeCreate = (table) => {
      if (table === 'taskDeliverableCompletion') throw new Error('record write failed');
    };
    expect(await completeTaskRow(5)).toBe(false);
    expect(db.find('task', { id: 5 })).toMatchObject({ status: 'in-progress' });
  });
});
