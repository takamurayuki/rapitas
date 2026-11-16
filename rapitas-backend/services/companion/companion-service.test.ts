/**
 * companion-service tests (companion design 4.3)
 *
 * The manual pair: "伴走して" makes (or reopens) the task's single row,
 * "伴走をやめる" closes it — conditionally, so a second stop is told there was
 * nothing open rather than reporting success twice.
 */
import { describe, expect, test, beforeEach } from 'bun:test';
import {
  startCompanion,
  stopCompanion,
  linkCompanionSource,
  type CompanionDb,
  type CompanionRow,
} from './companion-service';

let tasks: Map<number, string>;
let rows: Map<number, CompanionRow & Record<string, unknown>>;
let nextId: number;

function fakeDb(): CompanionDb {
  return {
    task: {
      findUnique: async ({ where }) =>
        tasks.has(where.id) ? { id: where.id, status: tasks.get(where.id) as string } : null,
    },
    taskCompanion: {
      findUnique: async ({ where }) => rows.get(where.taskId) ?? null,
      create: async ({ data }) => {
        const row = { id: nextId++, sourceActionId: null, closedAt: null, ...data };
        rows.set(data.taskId, row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = { ...(rows.get(where.taskId) as CompanionRow), ...data } as CompanionRow;
        rows.set(where.taskId, row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const [taskId, row] of rows) {
          const ids = (where.taskId as { in?: number[] })?.in;
          const matchTask = ids ? ids.includes(taskId) : where.taskId === taskId;
          const matchOpen = !('closedAt' in where) || row.closedAt === where.closedAt;
          const matchSource =
            !('sourceActionId' in where) || row.sourceActionId === where.sourceActionId;
          if (matchTask && matchOpen && matchSource) {
            rows.set(taskId, { ...row, ...data } as CompanionRow);
            count += 1;
          }
        }
        return { count };
      },
    },
  };
}

beforeEach(() => {
  tasks = new Map([
    [1, 'todo'],
    [2, 'done'],
  ]);
  rows = new Map();
  nextId = 1;
});

describe('startCompanion', () => {
  test('creates a manual row for a task that has none', async () => {
    const r = await startCompanion(fakeDb(), 1);
    expect(r).toMatchObject({ ok: true, outcome: 'started' });
    expect(rows.get(1)).toMatchObject({ taskId: 1, origin: 'manual', closedAt: null });
  });

  test('refuses an already-open row, a done task and a missing task', async () => {
    await startCompanion(fakeDb(), 1);
    expect(await startCompanion(fakeDb(), 1)).toEqual({ ok: false, reason: 'already_active' });
    expect(await startCompanion(fakeDb(), 2)).toEqual({ ok: false, reason: 'task_done' });
    expect(await startCompanion(fakeDb(), 404)).toEqual({ ok: false, reason: 'task_not_found' });
  });

  test('reopens a closed row instead of making a second one', async () => {
    rows.set(1, {
      id: 9,
      taskId: 1,
      origin: 'task_create',
      sourceActionId: 3,
      closedAt: new Date('2026-11-01'),
      closedReason: 'stopped_by_user',
    });
    const r = await startCompanion(fakeDb(), 1);
    expect(r).toMatchObject({ ok: true, outcome: 'reopened' });
    expect(rows.get(1)).toMatchObject({
      id: 9,
      origin: 'manual',
      closedAt: null,
      closedReason: null,
    });
    expect(rows.size).toBe(1);
  });
});

describe('stopCompanion', () => {
  test('closes an open row with stopped_by_user', async () => {
    await startCompanion(fakeDb(), 1);
    const r = await stopCompanion(fakeDb(), 1);
    expect(r.ok).toBe(true);
    expect(rows.get(1)?.closedAt).toBeInstanceOf(Date);
    expect(rows.get(1)?.closedReason).toBe('stopped_by_user');
  });

  test('a second stop (or a task never accompanied) is not_active', async () => {
    await startCompanion(fakeDb(), 1);
    await stopCompanion(fakeDb(), 1);
    expect(await stopCompanion(fakeDb(), 1)).toEqual({ ok: false, reason: 'not_active' });
    expect(await stopCompanion(fakeDb(), 2)).toEqual({ ok: false, reason: 'not_active' });
  });
});

describe('linkCompanionSource', () => {
  test('fills only rows that point nowhere yet', async () => {
    rows.set(1, { id: 1, taskId: 1, origin: 'task_create', sourceActionId: null, closedAt: null });
    rows.set(3, { id: 2, taskId: 3, origin: 'manual', sourceActionId: 5, closedAt: null });
    expect(await linkCompanionSource(fakeDb(), [1, 3], 42)).toBe(1);
    expect(rows.get(1)?.sourceActionId).toBe(42);
    expect(rows.get(3)?.sourceActionId).toBe(5);
  });

  test('does nothing without an audit id', async () => {
    expect(await linkCompanionSource(fakeDb(), [1], null)).toBe(0);
  });
});
