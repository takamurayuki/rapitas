/**
 * assistant-cleanup.delete.test
 *
 * The first thing ラピ can do that destroys something. Three properties
 * matter and none of them are about the response body: nothing is deleted
 * without the user's confirmation, what gets deleted is the list they
 * approved and nothing else, and every attempt — including a refusal — ends
 * up in the audit log, because a refused deletion leaves no other trace.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

/** Task ids the shared deletion path was asked to remove. */
let deleted: number[] = [];
/** Audit rows written. */
let audited: Record<string, unknown>[] = [];
/** Tasks the stand-in treats as protected. */
let protectedIds: number[] = [];
/** Ids that make the deletion path throw. */
let explodingIds: number[] = [];

mock.module('../../services/task/task-deletion', () => ({
  deleteTaskWithTrash: async (taskId: number, source: string) => {
    if (explodingIds.includes(taskId)) throw new Error('boom');
    if (protectedIds.includes(taskId)) return { taskId, outcome: 'protected' };
    deleted.push(taskId);
    return { taskId, outcome: 'deleted', trashId: 100 + taskId, source };
  },
}));

mock.module('../../config/database', () => ({
  prisma: {
    assistantAction: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audited.push(data);
        return { id: audited.length };
      },
    },
  },
  ensureDatabaseConnection: async () => {},
}));

mock.module('../../utils/ai-client', () => ({
  sendAIMessage: async () => ({ content: '{}', tokensUsed: 0 }),
}));

const { assistantCleanupRoutes } = await import('./assistant-cleanup.routes');

async function post(body: unknown) {
  const res = await assistantCleanupRoutes.handle(
    new Request('http://localhost/assistant/task-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: res.status < 500 ? await res.json().catch(() => null) : null };
}

beforeEach(() => {
  deleted = [];
  audited = [];
  protectedIds = [];
  explodingIds = [];
});

describe('POST /assistant/task-delete', () => {
  test('deletes exactly the ids it was given', async () => {
    const { status, json } = await post({ confirmed: true, taskIds: [11, 12] });
    expect(status).toBe(200);
    expect(deleted).toEqual([11, 12]);
    expect(json.results.map((r: { trashId: number }) => r.trashId)).toEqual([111, 112]);
  });

  // The gate. Both shapes of "the user did not agree to this".
  test.each([
    ['false', { confirmed: false, taskIds: [11] }],
    ['absent', { taskIds: [11] }],
  ])('deletes nothing when the confirmation is %s', async (_label, body) => {
    const { status } = await post(body);
    expect(status).not.toBe(200);
    expect(deleted).toEqual([]);
  });

  // There is deliberately no "delete everything matching" shape: a filter
  // evaluated here could match something that was not on screen.
  test('rejects an empty list rather than treating it as "all"', async () => {
    const { status } = await post({ confirmed: true, taskIds: [] });
    expect(status).not.toBe(200);
    expect(deleted).toEqual([]);
  });

  test('refuses a list longer than it will act on', async () => {
    const { status } = await post({
      confirmed: true,
      taskIds: Array.from({ length: 51 }, (_, i) => i + 1),
    });
    expect(status).not.toBe(200);
    expect(deleted).toEqual([]);
  });

  test('reports a protected task per-task instead of failing the batch', async () => {
    protectedIds = [12];
    const { json } = await post({ confirmed: true, taskIds: [11, 12, 13] });
    expect(deleted).toEqual([11, 13]);
    expect(json.results[1]).toMatchObject({ taskId: 12, outcome: 'protected' });
  });

  test('keeps going when one task throws', async () => {
    explodingIds = [12];
    const { json } = await post({ confirmed: true, taskIds: [11, 12, 13] });
    expect(deleted).toEqual([11, 13]);
    expect(json.results[1]).toMatchObject({ taskId: 12, outcome: 'failed' });
  });
});

describe('what the log keeps', () => {
  test('one row per task, carrying where the copy went', async () => {
    await post({ confirmed: true, taskIds: [11, 12] });
    const rows = audited.filter((a) => a.capabilityId === 'task.delete');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: 'executed', taskId: 11 });
    expect(JSON.parse(String(rows[0].resultJson)).trashId).toBe(111);
  });

  // A refused deletion changes nothing and notifies nobody. Without a row
  // there is no way to learn later that ラピ asked and was told no.
  test('records a refusal, which leaves no other trace', async () => {
    await post({ confirmed: false, taskIds: [11] });
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({ capabilityId: 'task.delete', status: 'refused' });
  });

  test('records a protected task as refused, not as done', async () => {
    protectedIds = [11];
    await post({ confirmed: true, taskIds: [11] });
    expect(audited[0]).toMatchObject({ status: 'refused', errorMessage: 'protected' });
  });
});
