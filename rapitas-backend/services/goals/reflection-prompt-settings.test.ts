/**
 * reflection-prompt-settings.test
 *
 * The nudge day/time live on UserSettings (default Sunday 20:00), invalid
 * values are refused, an unreadable column reads as the default, and the sent
 * week is claimed by one conditional update so only one tick can send.
 */
import { describe, expect, test } from 'bun:test';
import {
  createWeekClaimStore,
  readPromptSettings,
  writePromptSettings,
  type SettingsDb,
} from './reflection-prompt-settings';

interface Row {
  id: number;
  reflectionPromptDow: number;
  reflectionPromptTime: string;
  reflectionPromptLastWeek: string | null;
}

function fakeDb(initial: Row | null = null, opts: { failReads?: boolean } = {}) {
  let row = initial;
  const db: SettingsDb = {
    userSettings: {
      findFirst: async () => {
        if (opts.failReads) throw new Error('Unknown field reflectionPromptDow');
        return row;
      },
      create: async ({ data }) => {
        row = {
          id: 1,
          reflectionPromptDow: 0,
          reflectionPromptTime: '20:00',
          reflectionPromptLastWeek: null,
          ...data,
        };
        return row;
      },
      update: async ({ data }) => {
        row = { ...(row as Row), ...data };
        return row;
      },
      updateMany: async ({ where, data }) => {
        if (!row) return { count: 0 };
        const last = row.reflectionPromptLastWeek;
        const matches =
          'not' in where.reflectionPromptLastWeek
            ? last !== where.reflectionPromptLastWeek.not
            : last === where.reflectionPromptLastWeek.equals;
        if (!matches) return { count: 0 };
        row = { ...row, ...data };
        return { count: 1 };
      },
    },
  };
  return { db, get: () => row };
}

const base: Row = {
  id: 1,
  reflectionPromptDow: 0,
  reflectionPromptTime: '20:00',
  reflectionPromptLastWeek: null,
};

describe('prompt settings', () => {
  test('no row reads as Sunday 20:00', async () => {
    expect(await readPromptSettings(fakeDb().db)).toEqual({ dow: 0, time: '20:00' });
  });

  test('a saved value is read back, creating the row when absent', async () => {
    const { db, get } = fakeDb();
    expect(await writePromptSettings(db, { dow: 5, time: '18:30' })).toEqual({
      dow: 5,
      time: '18:30',
    });
    expect(get()).toMatchObject({ reflectionPromptDow: 5, reflectionPromptTime: '18:30' });
    expect(await readPromptSettings(db)).toEqual({ dow: 5, time: '18:30' });
  });

  test('an invalid value is refused and the stored one is kept', async () => {
    const { db } = fakeDb({ ...base, reflectionPromptDow: 5, reflectionPromptTime: '18:30' });
    expect(await writePromptSettings(db, { dow: 9, time: '18:30' })).toBeNull();
    expect(await writePromptSettings(db, { dow: 2, time: '6pm' })).toBeNull();
    expect(await readPromptSettings(db)).toEqual({ dow: 5, time: '18:30' });
  });

  test('a column the client does not know yet reads as the default', async () => {
    expect(await readPromptSettings(fakeDb(base, { failReads: true }).db)).toEqual({
      dow: 0,
      time: '20:00',
    });
  });
});

describe('week claim store', () => {
  test('the first claim wins and the second finds the week taken', async () => {
    const { db, get } = fakeDb(base);
    const claims = createWeekClaimStore(db);
    expect(await claims.claim('2026-11-23')).toEqual({ claimed: true, previous: null });
    expect(await claims.claim('2026-11-23')).toEqual({
      claimed: false,
      previous: '2026-11-23',
    });
    expect(get()?.reflectionPromptLastWeek).toBe('2026-11-23');
  });

  test('a new week can be claimed after an earlier one', async () => {
    const { db } = fakeDb({ ...base, reflectionPromptLastWeek: '2026-11-16' });
    expect(await createWeekClaimStore(db).claim('2026-11-23')).toEqual({
      claimed: true,
      previous: '2026-11-16',
    });
  });

  test('release restores the previous value only while the claim is still ours', async () => {
    const { db, get } = fakeDb({ ...base, reflectionPromptLastWeek: '2026-11-16' });
    const claims = createWeekClaimStore(db);
    await claims.claim('2026-11-23');
    await claims.release('2026-11-23', '2026-11-16');
    expect(get()?.reflectionPromptLastWeek).toBe('2026-11-16');
    await claims.release('2026-11-23', null); // not ours any more: no change
    expect(get()?.reflectionPromptLastWeek).toBe('2026-11-16');
  });

  test('creates the settings row when none exists so a claim is possible', async () => {
    const { db } = fakeDb();
    expect((await createWeekClaimStore(db).claim('2026-11-23')).claimed).toBe(true);
  });

  test('an unreadable column fails closed: nothing is claimed', async () => {
    const { db } = fakeDb(base, { failReads: true });
    expect((await createWeekClaimStore(db).claim('2026-11-23')).claimed).toBe(false);
  });
});
