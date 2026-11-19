/**
 * deliverable-check.test
 *
 * The hourly deliverable check (design §3.3): the baseline is written once and never
 * created from, unrecorded completions become `unknown`, re-evaluation
 * candidates change only `state` / `lastAttemptAt` (never `mode`), a deleted
 * `created` note is not recreated by a re-evaluation, and `failed` is retried
 * once a day.
 *
 * mock.module is process-global — run this file with --isolate.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { createStage1Db, type Stage1Db } from '../../../tests/helpers/notes-stage1-db';

let reply: string | Error = 'TITLE: 成果\nBODY:\n本文';
let calls = 0;
mock.module('../../../utils/ai-client', () => ({
  sendAIMessage: async () => {
    calls += 1;
    if (reply instanceof Error) throw reply;
    return { content: reply, tokensUsed: 0 };
  },
}));

const { completeWithRecord } = await import('./deliverable-completion');
const { runDeliverableCheck, FAILED_RETRY_MS } = await import('./deliverable-check');

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
// Waits for the background attempt the entry started: until the record leaves
// `pending` (or 2s), so a loaded suite does not race it.
const settle = async (taskId = 1) => {
  for (let i = 0; i < 200; i += 1) {
    const state = db.find('taskDeliverableCompletion', { taskId })?.state;
    if (state && state !== 'pending') return;
    await new Promise((r) => setTimeout(r, 10));
  }
};

beforeEach(() => {
  reply = 'TITLE: 成果\nBODY:\n本文';
  calls = 0;
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

describe('the hourly check', () => {
  it('baselines tasks done before the feature, once, and never creates from them', async () => {
    const first = await runDeliverableCheck(p());
    expect(first.baselined).toBe(1);
    expect(record(2)).toMatchObject({ mode: 'baseline', state: 'baseline' });
    expect(db.find('note', { id: 'deliverable-task-2' })).toBeUndefined();
    expect((await runDeliverableCheck(p())).baselined).toBe(0);
    // Editing an old done task does not make it a candidate.
    task(2).updatedAt = new Date();
    await runDeliverableCheck(p());
    expect(record(2)?.state).toBe('baseline');
    expect(calls).toBe(0);
  });

  it('leaves the baseline unmarked and the run failed when one baseline write fails (Must-fix 4)', async () => {
    db.rows('task').push(
      { ...task(2), id: 4, title: 'old done 2' },
      { ...task(2), id: 5, title: 'old done 3' },
    );
    db.hooks.beforeCreate = (table, data) => {
      if (table === 'taskDeliverableCompletion' && data.taskId === 4) throw new Error('disk I/O');
    };
    await expect(runDeliverableCheck(p())).rejects.toThrow();
    expect(db.rows('noteMigrationMarker')).toHaveLength(0);
    // The task whose baseline failed is NOT picked up as an unknown completion.
    expect(record(4)).toBeUndefined();
    expect(calls).toBe(0);

    db.hooks.beforeCreate = undefined;
    const retry = await runDeliverableCheck(p());
    expect(retry.baselined).toBe(1);
    expect(record(4)).toMatchObject({ mode: 'baseline', state: 'baseline' });
    expect(record(5)).toMatchObject({ mode: 'baseline', state: 'baseline' });
    expect(db.rows('noteMigrationMarker')).toHaveLength(1);
    expect(db.find('note', { id: 'deliverable-task-4' })).toBeUndefined();
  });

  it('records a completion no entry saw as unknown and creates from it', async () => {
    await runDeliverableCheck(p()); // baseline first
    task(1).status = 'done'; // completed by a path without an entry
    const result = await runDeliverableCheck(p());
    expect(result.found).toBe(1);
    expect(record(1)).toMatchObject({ mode: 'unknown', state: 'created' });
    expect(db.find('note', { id: 'deliverable-task-1' })).toBeDefined();
  });

  it('re-evaluates a not_eligible record after the task changed, keeping its mode', async () => {
    await runDeliverableCheck(p());
    (db.find('workflowFile', { taskId: 1 }) as Row).content = '短い';
    await completeTask(1);
    await settle();
    expect(record(1)?.state).toBe('not_eligible');
    (db.find('workflowFile', { taskId: 1 }) as Row).content = LONG;
    task(1).updatedAt = new Date(Date.now() + 60_000);
    await runDeliverableCheck(p());
    expect(record(1)).toMatchObject({ state: 'created', mode: 'ci_merge' });
  });

  it('does not recreate a created note a person deleted, and evaluates one edit once', async () => {
    await runDeliverableCheck(p());
    await completeTask(1);
    await settle();
    await db.prisma.note.deleteMany({ where: { id: 'deliverable-task-1' } });
    task(1).updatedAt = new Date(Date.now() + 60_000);
    const before = record(1)?.lastAttemptAt as Date;
    await runDeliverableCheck(p(), new Date(Date.now() + 120_000));
    expect(record(1)).toMatchObject({ state: 'created', mode: 'ci_merge' });
    expect((record(1)?.lastAttemptAt as Date).getTime()).toBeGreaterThan(before.getTime());
    expect(db.find('note', { id: 'deliverable-task-1' })).toBeUndefined();
    expect(calls).toBe(1);
  });

  it('retries a failed record only after a day', async () => {
    await runDeliverableCheck(p());
    reply = new Error('cli down');
    await completeTask(1);
    await settle();
    expect(record(1)?.state).toBe('failed');
    reply = 'TITLE: 成果\nBODY:\n本文';
    const failedAt = record(1)?.lastAttemptAt as Date;
    await runDeliverableCheck(p(), new Date(failedAt.getTime() + 60_000));
    expect(record(1)?.state).toBe('failed');
    await runDeliverableCheck(p(), new Date(failedAt.getTime() + FAILED_RETRY_MS + 1));
    expect(record(1)?.state).toBe('created');
  });
});
