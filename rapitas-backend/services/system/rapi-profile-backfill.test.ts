/**
 * rapi-profile-backfill.test
 *
 * The one-time move of the self-introduction from the files it used to live
 * in onto the row it lives on now (#1275).
 *
 * The tests are about the two ways a migration like this goes wrong: losing
 * what the user wrote, and handing it to the wrong account. The second is
 * the reason it only ever seeds the LOWEST settings id — a later boot must
 * not be able to give the file to an account created after the move.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { backfillRapiProfileToDatabase } from './rapi-profile-backfill';
import { MAX_RAPI_PROFILE_LENGTH, type SettingsDelegate } from './rapi-profile-store';

let dir: string;
let previousDataDir: string | undefined;

const profileFile = () => join(dir, '.rapi-profile');
const characterFile = () => join(dir, '.rapi-character');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rapitas-rapi-backfill-'));
  previousDataDir = process.env.RAPITAS_DATA_DIR;
  process.env.RAPITAS_DATA_DIR = dir;
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = previousDataDir;
  rmSync(dir, { recursive: true, force: true });
});

/** One row of the fake table. A type, not an interface, so it is assignable. */
type FakeRow = {
  id: number;
  rapiProfile: string | null;
  rapiCharacter: string | null;
};

/**
 * The unscoped `userSettings` delegate the backfill sees at startup.
 *
 * There is no workspace context during warm-up, so the extension passes
 * every query through and `findFirst` sees the whole table — which is what
 * makes "lowest id" mean "the row that existed before tenancy".
 */
function fakeSettings(seed: Partial<FakeRow>[] = []) {
  let nextId = 1;
  const rows: FakeRow[] = seed.map((row) => ({
    id: row.id ?? nextId++,
    rapiProfile: row.rapiProfile ?? null,
    rapiCharacter: row.rapiCharacter ?? null,
  }));
  for (const row of rows) nextId = Math.max(nextId, row.id + 1);

  const delegate: SettingsDelegate = {
    findFirst: async () => {
      const [lowest] = [...rows].sort((a, b) => a.id - b.id);
      return lowest ? { ...lowest } : null;
    },
    create: async () => {
      const row: FakeRow = { id: nextId++, rapiProfile: null, rapiCharacter: null };
      rows.push(row);
      return { ...row };
    },
    update: async (args: unknown) => {
      const { where, data } = args as { where: { id: number }; data: Partial<FakeRow> };
      const row = rows.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error(`no settings row ${where.id}`);
      Object.assign(row, data);
      return { ...row };
    },
  };
  return { delegate, rows };
}

describe('moving what was already written', () => {
  test('copies both halves onto the settings row', async () => {
    writeFileSync(profileFile(), 'エンジニア8年');
    writeFileSync(characterFile(), '納得してから動きたい');
    const { delegate, rows } = fakeSettings([{}]);

    expect(await backfillRapiProfileToDatabase(delegate)).toBe(2);
    expect(rows[0]?.rapiProfile).toBe('エンジニア8年');
    expect(rows[0]?.rapiCharacter).toBe('納得してから動きたい');
  });

  test('copies one half when only one was ever written', async () => {
    writeFileSync(profileFile(), 'エンジニア8年');
    const { delegate, rows } = fakeSettings([{}]);

    expect(await backfillRapiProfileToDatabase(delegate)).toBe(1);
    expect(rows[0]?.rapiProfile).toBe('エンジニア8年');
    expect(rows[0]?.rapiCharacter).toBeNull();
  });

  test('leaves the files on disk', async () => {
    // Deleting them is irreversible, and nothing reads them once the
    // columns are filled.
    writeFileSync(profileFile(), 'エンジニア8年');
    const { delegate } = fakeSettings([{}]);

    await backfillRapiProfileToDatabase(delegate);
    expect(existsSync(profileFile())).toBe(true);
  });

  test('caps an over-long file the same way a save would', async () => {
    writeFileSync(profileFile(), 'あ'.repeat(MAX_RAPI_PROFILE_LENGTH + 500));
    const { delegate, rows } = fakeSettings([{}]);

    await backfillRapiProfileToDatabase(delegate);
    expect(rows[0]?.rapiProfile?.length).toBe(MAX_RAPI_PROFILE_LENGTH);
  });
});

describe('not overwriting and not repeating', () => {
  test('leaves a column that already says something', async () => {
    writeFileSync(profileFile(), '古いファイルの内容');
    const { delegate, rows } = fakeSettings([{ rapiProfile: '設定画面で書き直した内容' }]);

    expect(await backfillRapiProfileToDatabase(delegate)).toBe(0);
    expect(rows[0]?.rapiProfile).toBe('設定画面で書き直した内容');
  });

  test('does nothing on the second run', async () => {
    writeFileSync(profileFile(), 'エンジニア8年');
    const { delegate } = fakeSettings([{}]);

    expect(await backfillRapiProfileToDatabase(delegate)).toBe(1);
    expect(await backfillRapiProfileToDatabase(delegate)).toBe(0);
  });

  test('does nothing when there is nothing on disk', async () => {
    const { delegate } = fakeSettings([{}]);
    expect(await backfillRapiProfileToDatabase(delegate)).toBe(0);
  });

  test('treats a blank file as nothing written', async () => {
    writeFileSync(profileFile(), '   \n  ');
    const { delegate, rows } = fakeSettings([{}]);

    expect(await backfillRapiProfileToDatabase(delegate)).toBe(0);
    expect(rows[0]?.rapiProfile).toBeNull();
  });
});

describe('handing it to the right account', () => {
  test('seeds only the oldest row, never a newer account', async () => {
    // The defect this guards: a second account signs up, gets a settings
    // row with empty columns, and the next boot hands it the first user's
    // self-introduction.
    writeFileSync(profileFile(), '最初の人の自己紹介');
    const { delegate, rows } = fakeSettings([{ id: 1 }, { id: 7 }]);

    await backfillRapiProfileToDatabase(delegate);
    expect(rows.find((row) => row.id === 1)?.rapiProfile).toBe('最初の人の自己紹介');
    expect(rows.find((row) => row.id === 7)?.rapiProfile).toBeNull();
  });

  test('stays put when the oldest row already has one, even if a newer does not', async () => {
    writeFileSync(profileFile(), '最初の人の自己紹介');
    const { delegate, rows } = fakeSettings([{ id: 1, rapiProfile: '書き直した' }, { id: 7 }]);

    expect(await backfillRapiProfileToDatabase(delegate)).toBe(0);
    expect(rows.find((row) => row.id === 7)?.rapiProfile).toBeNull();
  });

  test('does nothing when no account has settings yet', async () => {
    writeFileSync(profileFile(), 'エンジニア8年');
    const { delegate, rows } = fakeSettings();

    expect(await backfillRapiProfileToDatabase(delegate)).toBe(0);
    expect(rows).toHaveLength(0);
  });
});

describe('never breaking start-up', () => {
  test('returns zero instead of throwing when the row cannot be reached', async () => {
    // This runs in the warm-up list. A migration that throws there takes
    // the backend down with it, and the backend is how the agent reaches
    // itself.
    writeFileSync(profileFile(), 'エンジニア8年');
    const broken: SettingsDelegate = {
      findFirst: async () => {
        throw new Error('relation "UserSettings" does not exist');
      },
      create: async () => {
        throw new Error('unused');
      },
      update: async () => {
        throw new Error('unused');
      },
    };

    expect(await backfillRapiProfileToDatabase(broken)).toBe(0);
  });

  test('returns zero instead of throwing when the write fails', async () => {
    writeFileSync(profileFile(), 'エンジニア8年');
    const { delegate } = fakeSettings([{}]);
    const failingUpdate: SettingsDelegate = {
      ...delegate,
      update: async () => {
        throw new Error('column "rapiProfile" does not exist');
      },
    };

    expect(await backfillRapiProfileToDatabase(failingUpdate)).toBe(0);
  });
});
