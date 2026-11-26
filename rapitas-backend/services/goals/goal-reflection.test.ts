/**
 * goal-reflection.test
 *
 * The weekly 前進の振り返り: rating 1-5 integer, note up to 500 characters,
 * one row per goal per week (Monday, Asia/Tokyo), trend oldest first.
 */
import { describe, expect, test } from 'bun:test';
import {
  getWeekStart,
  listReflections,
  saveReflection,
  validateReflectionInput,
  type ReflectionDb,
  type ReflectionRow,
} from './goal-reflection';

/** In-memory stand-in honouring the (projectId, weekStart) unique key. */
function fakeDb(projectIds: number[] = [1, 2]): ReflectionDb & { rows: ReflectionRow[] } {
  const rows: ReflectionRow[] = [];
  return {
    rows,
    project: {
      findUnique: async ({ where }) => (projectIds.includes(where.id) ? { id: where.id } : null),
    },
    goalReflection: {
      upsert: async ({ where, create, update }) => {
        const key = where.projectId_weekStart;
        const found = rows.find(
          (r) => r.projectId === key.projectId && r.weekStart === key.weekStart,
        );
        if (found) {
          Object.assign(found, update, { updatedAt: new Date('2026-11-27T00:00:00Z') });
          return found;
        }
        const row = { ...create, updatedAt: new Date('2026-11-26T00:00:00Z') } as ReflectionRow;
        rows.push(row);
        return row;
      },
      findMany: async ({ where }) =>
        rows
          .filter((r) => r.projectId === where.projectId)
          .sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
    },
  };
}

describe('getWeekStart', () => {
  test('returns the Monday of the week in Asia/Tokyo', () => {
    // 2026-11-26 is a Thursday (JST) -> Monday 2026-11-23
    expect(getWeekStart(new Date('2026-11-26T03:00:00Z'))).toBe('2026-11-23');
  });

  test('Sunday 23:59 JST is still the same week; Monday 00:00 JST starts the next', () => {
    expect(getWeekStart(new Date('2026-11-29T14:59:00Z'))).toBe('2026-11-23'); // Sun 23:59 JST
    expect(getWeekStart(new Date('2026-11-29T15:00:00Z'))).toBe('2026-11-30'); // Mon 00:00 JST
  });

  test('uses JST, not UTC, around the date line', () => {
    // Monday 2026-11-23 08:00 JST is still Sunday 23:00 UTC
    expect(getWeekStart(new Date('2026-11-22T23:00:00Z'))).toBe('2026-11-23');
  });

  test('crosses year boundaries', () => {
    expect(getWeekStart(new Date('2027-01-01T00:00:00Z'))).toBe('2026-12-28');
  });
});

describe('validateReflectionInput', () => {
  test.each([1, 2, 3, 4, 5])('accepts rating %p', (rating) => {
    expect(validateReflectionInput({ rating })).toEqual({ ok: true, rating, note: null });
  });

  test.each([0, 6, -1, 1.5, '3', null, undefined, NaN, Infinity])('rejects rating %p', (rating) => {
    expect(validateReflectionInput({ rating })).toEqual({
      ok: false,
      code: 'reflection_rating_invalid',
    });
  });

  test('accepts a 500-character note and rejects 501', () => {
    expect(validateReflectionInput({ rating: 3, note: 'あ'.repeat(500) }).ok).toBe(true);
    expect(validateReflectionInput({ rating: 3, note: 'あ'.repeat(501) })).toEqual({
      ok: false,
      code: 'reflection_note_too_long',
    });
  });

  test('judges length before trimming: 500 characters plus trailing whitespace is refused', () => {
    expect(validateReflectionInput({ rating: 3, note: 'a'.repeat(500) + ' ' })).toEqual({
      ok: false,
      code: 'reflection_note_too_long',
    });
  });

  test('counts code points, so 500 emoji are accepted', () => {
    expect(validateReflectionInput({ rating: 3, note: '😀'.repeat(500) }).ok).toBe(true);
    expect(validateReflectionInput({ rating: 3, note: '😀'.repeat(501) }).ok).toBe(false);
  });

  test('treats a blank note as no note and trims the rest', () => {
    expect(validateReflectionInput({ rating: 4, note: '   ' })).toEqual({
      ok: true,
      rating: 4,
      note: null,
    });
    expect(validateReflectionInput({ rating: 4, note: ' 進んだ ' })).toEqual({
      ok: true,
      rating: 4,
      note: '進んだ',
    });
  });

  test('rejects a non-string note', () => {
    expect(validateReflectionInput({ rating: 4, note: 5 })).toEqual({
      ok: false,
      code: 'reflection_note_invalid',
    });
  });
});

describe('saveReflection', () => {
  const now = new Date('2026-11-26T03:00:00Z');

  test('creates the row for the current week', async () => {
    const db = fakeDb();
    const result = await saveReflection(db, { projectId: 1, rating: 4, note: '進んだ', now });
    expect(result).toMatchObject({
      ok: true,
      item: { projectId: 1, weekStart: '2026-11-23', rating: 4, note: '進んだ' },
    });
    expect(db.rows).toHaveLength(1);
  });

  test('a second save for the same goal and week updates the one row', async () => {
    const db = fakeDb();
    await saveReflection(db, { projectId: 1, rating: 2, note: 'ぼちぼち', now });
    await saveReflection(db, {
      projectId: 1,
      rating: 5,
      note: null,
      now: new Date('2026-11-28T10:00:00Z'),
    });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ rating: 5, note: null });
  });

  test('another goal or another week is a separate row', async () => {
    const db = fakeDb();
    await saveReflection(db, { projectId: 1, rating: 3, now });
    await saveReflection(db, { projectId: 2, rating: 3, now });
    await saveReflection(db, { projectId: 1, rating: 3, now: new Date('2026-12-03T03:00:00Z') });
    expect(db.rows).toHaveLength(3);
  });

  test('invalid input is refused and nothing is stored', async () => {
    const db = fakeDb();
    expect(await saveReflection(db, { projectId: 1, rating: 6, now })).toEqual({
      ok: false,
      code: 'reflection_rating_invalid',
    });
    expect(
      await saveReflection(db, { projectId: 1, rating: 3, note: 'x'.repeat(501), now }),
    ).toEqual({
      ok: false,
      code: 'reflection_note_too_long',
    });
    expect(db.rows).toHaveLength(0);
  });

  test('an unknown goal is refused', async () => {
    const db = fakeDb([1]);
    expect(await saveReflection(db, { projectId: 9, rating: 3, now })).toEqual({
      ok: false,
      code: 'reflection_goal_not_found',
    });
  });

  test('an explicit weekStart edits an earlier week; a non-Monday or future week is refused', async () => {
    const db = fakeDb();
    const ok = await saveReflection(db, { projectId: 1, rating: 3, weekStart: '2026-11-16', now });
    expect(ok).toMatchObject({ ok: true, item: { weekStart: '2026-11-16' } });
    for (const weekStart of ['2026-11-17', '2026-11-30', 'bogus', '2026-02-30']) {
      expect(await saveReflection(db, { projectId: 1, rating: 3, weekStart, now })).toEqual({
        ok: false,
        code: 'reflection_week_invalid',
      });
    }
  });
});

describe('saving closes the nudge', () => {
  test('marks this week prompt notification read, and tolerates a failing update', async () => {
    const calls: unknown[] = [];
    const db = {
      ...fakeDb(),
      notification: { updateMany: async (args: unknown) => void calls.push(args) },
    };
    const now = new Date('2026-11-26T03:00:00Z');
    await saveReflection(db, { projectId: 1, rating: 3, now });
    expect(calls).toHaveLength(1);
    expect(
      (calls[0] as { where: { metadata: { contains: string } } }).where.metadata.contains,
    ).toBe('"weekStart":"2026-11-23"');
    const failing = {
      ...fakeDb(),
      notification: { updateMany: async () => Promise.reject(new Error('x')) },
    };
    expect(await saveReflection(failing, { projectId: 1, rating: 3, now })).toMatchObject({
      ok: true,
    });
  });
});

describe('listReflections', () => {
  test('returns the goal weeks oldest first, without other goals', async () => {
    const db = fakeDb();
    await saveReflection(db, { projectId: 1, rating: 5, now: new Date('2026-12-03T03:00:00Z') });
    await saveReflection(db, { projectId: 1, rating: 2, now: new Date('2026-11-18T03:00:00Z') });
    await saveReflection(db, { projectId: 2, rating: 4, now: new Date('2026-11-18T03:00:00Z') });
    const result = await listReflections(db, 1);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.items.map((i) => [i.projectId, i.weekStart, i.rating])).toEqual([
      [1, '2026-11-16', 2],
      [1, '2026-11-30', 5],
    ]);
    expect(Object.keys(result.items[0]).sort()).toEqual([
      'note',
      'projectId',
      'rating',
      'updatedAt',
      'weekStart',
    ]);
  });

  test('no records is an empty list; an unknown goal is refused', async () => {
    const db = fakeDb([1]);
    expect(await listReflections(db, 1)).toEqual({ ok: true, items: [] });
    expect(await listReflections(db, 9)).toEqual({ ok: false, code: 'reflection_goal_not_found' });
  });
});
