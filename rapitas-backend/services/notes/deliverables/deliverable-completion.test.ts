/**
 * deliverable-completion.test
 *
 * The entry side of the deliverable automation (design §3.3「完了とモードを同時に
 * 永続化する」): the completion and its record are written in one transaction
 * with one time (task updatedAt = record completedAt), a failed record write
 * undoes the completion, a re-completion sets the new mode and state back to
 * pending, and the manual completion carries the record in its batch.
 *
 * mock.module is process-global — run this file with --isolate.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { createStage1Db, type Stage1Db } from '../../../tests/helpers/notes-stage1-db';

let reply: string | Error = 'TITLE: 成果\nBODY:\n本文';
mock.module('../../../utils/ai-client', () => ({
  sendAIMessage: async () => {
    if (reply instanceof Error) throw reply;
    return { content: reply, tokensUsed: 0 };
  },
}));

const { completeWithRecord } = await import('./deliverable-completion');
const { writeTaskStatusUpdate } = await import('../../task/task-status-write');

type Row = Record<string, unknown>;
const LONG = '変更点と確認結果を記録した。'.repeat(20);
let db: Stage1Db;
const p = () => db.prisma as never;
const record = (taskId: number) =>
  db.find('taskDeliverableCompletion', { taskId }) as Row | undefined;
const task = (id: number) => db.find('task', { id }) as Row;
const completeTask = (id: number, mode: 'ci_merge' | 'recovery' = 'ci_merge') =>
  completeWithRecord(p(), id, mode, (client, at) =>
    (
      client as never as { task: { updateMany: (a: unknown) => Promise<{ count: number }> } }
    ).task.updateMany({
      where: { id, status: 'in-progress' },
      data: { status: 'done', completedAt: at, updatedAt: at },
    }),
  );
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  reply = 'TITLE: 成果\nBODY:\n本文';
  db = createStage1Db({
    task: [
      { id: 1, status: 'in-progress', title: 'A' },
      { id: 2, status: 'done', title: 'old done', updatedAt: new Date('2026-01-01T00:00:00Z') },
      { id: 3, status: 'in-progress', title: 'C' },
    ],
    workflowFile: [
      { taskId: 1, fileType: 'verify', content: LONG },
      { taskId: 2, fileType: 'verify', content: LONG },
    ],
  });
});

describe('the entry writes the record with the completion (same transaction)', () => {
  it('writes one time to the task’s updatedAt and the record’s completedAt', async () => {
    expect(await completeTask(1)).toBe(true);
    expect(record(1)).toMatchObject({ mode: 'ci_merge', state: 'pending' });
    expect((record(1)?.completedAt as Date).getTime()).toBe((task(1).updatedAt as Date).getTime());
    await settle();
    expect(db.find('note', { id: 'deliverable-task-1' })).toBeDefined();
  });

  it('undoes the completion when the record cannot be written', async () => {
    db.hooks.beforeCreate = (table) => {
      if (table === 'taskDeliverableCompletion') throw new Error('record write failed');
    };
    await expect(completeTask(1)).rejects.toThrow('record write failed');
    expect(task(1).status).toBe('in-progress');
    expect(record(1)).toBeUndefined();
  });

  it('writes no record when the completion itself was not written', async () => {
    expect(await completeTask(2)).toBe(false); // already done: the condition matches nothing
    expect(record(2)).toBeUndefined();
  });

  it('a re-completion resets state to pending and records the new mode', async () => {
    await completeTask(1);
    await settle();
    task(1).status = 'in-progress';
    await completeTask(1, 'recovery');
    expect(record(1)).toMatchObject({ mode: 'recovery', state: 'pending' });
  });

  it('the manual completion carries the record in its batch transaction', async () => {
    const at = new Date('2026-11-19T10:00:00Z');
    db.prisma.themeAutoRun = { updateMany: async () => ({ count: 0 }) };
    await writeTaskStatusUpdate(
      p(),
      3,
      { where: { id: 3 }, data: { status: 'done', completedAt: at, updatedAt: at } } as never,
      'done',
      { completing: true, completionAt: at, workspaceId: null },
    );
    expect(task(3)).toMatchObject({ status: 'done' });
    expect(record(3)).toMatchObject({ mode: 'manual', state: 'pending', completedAt: at });
    expect((task(3).updatedAt as Date).getTime()).toBe(at.getTime());
  });
});
