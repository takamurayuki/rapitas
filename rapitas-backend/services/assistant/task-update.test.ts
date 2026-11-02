/**
 * task-update tests (#1119 stage 6)
 *
 * ラピ may change a task's status, priority, theme and due date — one declared
 * capability, confirmed by the user, and reversible. These pin what is
 * accepted, what is written, and that an undo only restores what nobody has
 * touched since.
 */
import { describe, test, expect } from 'bun:test';
import {
  validateTaskChanges,
  applyTaskUpdate,
  revertTaskUpdate,
  type TaskUpdateDb,
} from './task-update';

type Row = {
  id: number;
  status: string;
  priority: string;
  themeId: number | null;
  dueDate: Date | null;
};

function fakeDb(row: Row | null, themes: number[] = [1, 2]) {
  const state = { row: row ? { ...row } : null, updates: [] as unknown[] };
  const db: TaskUpdateDb = {
    task: {
      findUnique: async () => (state.row ? { ...state.row } : null),
      update: async ({ data }: { data: Partial<Row> }) => {
        state.updates.push(data);
        state.row = { ...(state.row as Row), ...data };
        return state.row;
      },
    },
    theme: {
      findUnique: async ({ where }: { where: { id: number } }) =>
        themes.includes(where.id) ? { id: where.id } : null,
    },
  } as never;
  return { db, state };
}

const base: Row = {
  id: 5,
  status: 'todo',
  priority: 'medium',
  themeId: 1,
  dueDate: null,
};

describe('validateTaskChanges', () => {
  test('accepts the four fields with valid values', () => {
    const r = validateTaskChanges({
      status: 'in-progress',
      priority: 'urgent',
      themeId: 2,
      dueDate: '2026-12-01',
    });
    expect(r).toEqual({
      ok: true,
      changes: { status: 'in-progress', priority: 'urgent', themeId: 2, dueDate: '2026-12-01' },
    });
  });

  test.each([
    [{ status: 'archived' }, 'status'],
    [{ priority: 'critical' }, 'priority'],
    [{ themeId: 0 }, 'themeId'],
    [{ dueDate: '2026-13-40' }, 'dueDate'],
    [{ dueDate: '12/01/2026' }, 'dueDate'],
    [{ title: 'renamed' }, 'title'],
    [{}, 'nothing'],
  ])('rejects %o', (raw, word) => {
    const r = validateTaskChanges(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(word);
  });

  test('null clears the theme and the due date', () => {
    expect(validateTaskChanges({ themeId: null, dueDate: null })).toEqual({
      ok: true,
      changes: { themeId: null, dueDate: null },
    });
  });
});

describe('applyTaskUpdate', () => {
  test('writes only the changed fields and returns before/after', async () => {
    const { db, state } = fakeDb(base);
    const r = await applyTaskUpdate(db, 5, { status: 'done', priority: 'medium' });
    expect(r).toEqual({
      ok: true,
      before: { status: 'todo' },
      after: { status: 'done' },
    });
    expect(state.updates).toEqual([{ status: 'done' }]);
  });

  test('a task in the trash (gone from Task) is not found, and nothing is written', async () => {
    const { db, state } = fakeDb(null);
    expect(await applyTaskUpdate(db, 5, { status: 'done' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(state.updates).toEqual([]);
  });

  test('refuses a theme that does not exist', async () => {
    const { db } = fakeDb(base, [1]);
    expect(await applyTaskUpdate(db, 5, { themeId: 9 })).toEqual({
      ok: false,
      reason: 'theme_not_found',
    });
  });

  test('reports a no-op rather than writing', async () => {
    const { db, state } = fakeDb(base);
    expect(await applyTaskUpdate(db, 5, { status: 'todo' })).toEqual({
      ok: false,
      reason: 'no_change',
    });
    expect(state.updates).toEqual([]);
  });

  test('stores the due date as a Date and reports it as YYYY-MM-DD', async () => {
    const { db, state } = fakeDb(base);
    const r = await applyTaskUpdate(db, 5, { dueDate: '2026-12-01' });
    expect(r).toMatchObject({
      ok: true,
      before: { dueDate: null },
      after: { dueDate: '2026-12-01' },
    });
    expect((state.updates[0] as { dueDate: Date }).dueDate).toBeInstanceOf(Date);
  });
});

describe('revertTaskUpdate', () => {
  test('restores the previous values when nothing changed since', async () => {
    const { db, state } = fakeDb({ ...base, status: 'done', priority: 'urgent' });
    const r = await revertTaskUpdate(db, 5, {
      before: { status: 'todo', priority: 'medium' },
      after: { status: 'done', priority: 'urgent' },
    });
    expect(r).toEqual({ ok: true });
    expect(state.row).toMatchObject({ status: 'todo', priority: 'medium' });
  });

  test('refuses when someone changed a field after ラピ did, and names it', async () => {
    const { db, state } = fakeDb({ ...base, status: 'in-progress', priority: 'urgent' });
    const r = await revertTaskUpdate(db, 5, {
      before: { status: 'todo', priority: 'medium' },
      after: { status: 'done', priority: 'urgent' },
    });
    expect(r).toEqual({ ok: false, reason: 'changed_since', conflicts: ['status'] });
    expect(state.updates).toEqual([]);
  });
});
