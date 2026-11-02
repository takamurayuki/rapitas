/**
 * rapi-profile-store.test
 *
 * What ラピ is told about the person she is planning for.
 *
 * Asked for 2026-10-22: the interview re-asks who you are on every roadmap,
 * which is work the user already did last time. A standing self-introduction
 * answers it once.
 *
 * Stored on the account's own `UserSettings` row since #1275. It used to be
 * two files in RAPITAS_DATA_DIR, which was right while there was one user:
 * once accounts existed, every account on the install shared one
 * introduction and the last save won. Hence the isolation test below.
 *
 * The rest of the tests are about the two ways this can hurt rather than
 * help: a profile long enough to crowd out the request it is supposed to
 * inform, and a save that looks like it worked when it did not.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  MAX_RAPI_PROFILE_LENGTH,
  readRapiCharacter,
  readRapiProfile,
  writeRapiCharacter,
  writeRapiProfile,
  type SettingsDelegate,
} from './rapi-profile-store';

/**
 * Point RAPITAS_DATA_DIR at a temp directory for the whole file.
 *
 * Nothing here should touch the filesystem — the store is a column now. The
 * guard is here because running these tests against the file-backed version
 * they replaced wrote their fixtures straight into the real `~/.rapitas` and
 * destroyed the user's own self-introduction (2026-10-30). If a file write
 * is ever reintroduced, it lands in a temp directory instead of someone's
 * home.
 */
let dataDir: string;
let previousDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'rapitas-rapi-profile-'));
  previousDataDir = process.env.RAPITAS_DATA_DIR;
  process.env.RAPITAS_DATA_DIR = dataDir;
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

/** One row of the fake table. A type, not an interface, so it is assignable. */
type FakeRow = {
  id: number;
  rapiProfile: string | null;
  rapiCharacter: string | null;
};

/**
 * A stand-in for the workspace-scoped `userSettings` delegate.
 *
 * Injected rather than replaced with `mock.module`, which bun applies
 * process-wide to every other test file in the run.
 *
 * One instance is ONE account's view of the table — which is exactly what
 * the workspace extension hands the store at runtime, since `UserSettings`
 * carries `workspaceId` and is in owned-models. Two instances are therefore
 * two accounts, and that is how the isolation test is written.
 *
 * `findFirst` ignores its arguments and answers with the lowest id, because
 * the lowest id with `orderBy: { id: 'asc' }` is the only thing the store
 * ever asks for.
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

/** A delegate whose every call fails, for the fail-soft / fail-loud tests. */
const brokenSettings: SettingsDelegate = {
  findFirst: async () => {
    throw new Error('relation "UserSettings" does not exist');
  },
  create: async () => {
    throw new Error('relation "UserSettings" does not exist');
  },
  update: async () => {
    throw new Error('relation "UserSettings" does not exist');
  },
};

describe('reading it back', () => {
  test('is null before there is even a settings row', async () => {
    const { delegate } = fakeSettings();
    expect(await readRapiProfile(delegate)).toBeNull();
  });

  test('is null when nothing has been said', async () => {
    const { delegate } = fakeSettings([{}]);
    expect(await readRapiProfile(delegate)).toBeNull();
  });

  test('round-trips what was written', async () => {
    const { delegate } = fakeSettings([{}]);
    await writeRapiProfile('30代のソフトウェアエンジニア。toB SaaS の経験が8年。', delegate);
    expect(await readRapiProfile(delegate)).toBe(
      '30代のソフトウェアエンジニア。toB SaaS の経験が8年。',
    );
  });

  test('stores it on the settings row, not somewhere of its own', async () => {
    // The whole point of #1275: the value has to live where the workspace
    // extension can scope it, which means the row and nothing else.
    const { delegate, rows } = fakeSettings([{}]);
    await writeRapiProfile('エンジニア8年', delegate);
    expect(rows[0]?.rapiProfile).toBe('エンジニア8年');
  });

  test('keeps the line breaks someone wrote it with', async () => {
    // A self-introduction is a short paragraph or a list, not one line, and
    // flattening it would change what the model is told.
    const { delegate } = fakeSettings([{}]);
    await writeRapiProfile('職種: エンジニア\n希望: リモート\n制約: 平日夜のみ', delegate);
    expect(await readRapiProfile(delegate)).toBe(
      '職種: エンジニア\n希望: リモート\n制約: 平日夜のみ',
    );
  });

  test('treats a blank column as nothing said', async () => {
    const { delegate } = fakeSettings([{ rapiProfile: '   \n  ' }]);
    expect(await readRapiProfile(delegate)).toBeNull();
  });

  test('is null when the row cannot be read at all', async () => {
    // Fail soft on READ: a settings page and a roadmap are both more useful
    // without the introduction than not at all. This is also the state
    // between merging the column and the restart that adds it.
    expect(await readRapiProfile(brokenSettings)).toBeNull();
  });
});

describe('writing it', () => {
  test('trims the edges without touching the middle', async () => {
    const { delegate } = fakeSettings([{}]);
    await writeRapiProfile('  職種: エンジニア\n希望: リモート  ', delegate);
    expect(await readRapiProfile(delegate)).toBe('職種: エンジニア\n希望: リモート');
  });

  test('clears it when given nothing', async () => {
    const { delegate } = fakeSettings([{}]);
    await writeRapiProfile('書いた', delegate);
    await writeRapiProfile('   ', delegate);
    expect(await readRapiProfile(delegate)).toBeNull();
  });

  test('caps what it will store', async () => {
    // The profile rides in front of every roadmap request. Unbounded, it
    // becomes the prompt and the thing actually being asked for becomes a
    // footnote.
    const { delegate } = fakeSettings([{}]);
    await writeRapiProfile('あ'.repeat(MAX_RAPI_PROFILE_LENGTH + 500), delegate);
    expect((await readRapiProfile(delegate))?.length).toBe(MAX_RAPI_PROFILE_LENGTH);
  });

  test('caps what it will read back, however the column got that long', async () => {
    // Editing the row by hand is not the supported path, but it must not be
    // able to smuggle an unbounded prompt in either.
    const { delegate } = fakeSettings([
      { rapiProfile: 'い'.repeat(MAX_RAPI_PROFILE_LENGTH + 500) },
    ]);
    expect((await readRapiProfile(delegate))?.length).toBe(MAX_RAPI_PROFILE_LENGTH);
  });

  test('makes the settings row when the account has none yet', async () => {
    const { delegate, rows } = fakeSettings();
    await writeRapiProfile('はじめて書いた', delegate);
    expect(rows).toHaveLength(1);
    expect(await readRapiProfile(delegate)).toBe('はじめて書いた');
  });

  test('says so when the save did not happen', async () => {
    // Fail LOUD on write, unlike the file it replaced: the settings card
    // shows 保存しました on a 2xx, so a swallowed failure is the card lying
    // about the profile ラピ is planning against.
    await expect(writeRapiProfile('書いた', brokenSettings)).rejects.toThrow();
  });
});

describe('one account cannot read or overwrite another', () => {
  /**
   * The defect #1275 fixes. Two delegates are two accounts: the extension
   * hands each request the rows of its own workspace, so a value written
   * through one is invisible through the other.
   */
  test('a second account starts with nothing said', async () => {
    const mine = fakeSettings([{}]);
    const theirs = fakeSettings([{}]);
    await writeRapiProfile('私の自己紹介', mine.delegate);
    expect(await readRapiProfile(theirs.delegate)).toBeNull();
  });

  test('a second account writing does not touch the first', async () => {
    const mine = fakeSettings([{}]);
    const theirs = fakeSettings([{}]);
    await writeRapiProfile('私の自己紹介', mine.delegate);
    await writeRapiProfile('別の人の自己紹介', theirs.delegate);
    expect(await readRapiProfile(mine.delegate)).toBe('私の自己紹介');
  });
});

describe('the second half: what kind of person they are', () => {
  /**
   * Facts and character are stored apart on purpose.
   *
   * The facts say what someone CAN do — the role, the hours, the
   * constraints. The character says what they actually want out of it, and
   * that is the half that decides whether a plan is the RIGHT plan rather
   * than merely a feasible one. Kept separate so the prompt can label them
   * separately, and so clearing one never clears the other.
   */
  test('is nothing until it is written', async () => {
    const { delegate } = fakeSettings([{}]);
    expect(await readRapiCharacter(delegate)).toBeNull();
  });

  test('round-trips what was written', async () => {
    const { delegate } = fakeSettings([{}]);
    await writeRapiCharacter('納得してから動きたい。人数の多い場が苦手。', delegate);
    expect(await readRapiCharacter(delegate)).toBe('納得してから動きたい。人数の多い場が苦手。');
  });

  test('does not share a slot with the facts', async () => {
    const { delegate } = fakeSettings([{}]);
    await writeRapiProfile('エンジニア8年', delegate);
    await writeRapiCharacter('納得してから動きたい', delegate);
    expect(await readRapiProfile(delegate)).toBe('エンジニア8年');
    expect(await readRapiCharacter(delegate)).toBe('納得してから動きたい');
  });

  test('clearing one leaves the other alone', async () => {
    const { delegate } = fakeSettings([{}]);
    await writeRapiProfile('エンジニア8年', delegate);
    await writeRapiCharacter('納得してから動きたい', delegate);
    await writeRapiCharacter('', delegate);
    expect(await readRapiCharacter(delegate)).toBeNull();
    expect(await readRapiProfile(delegate)).toBe('エンジニア8年');
  });

  test('is capped the same way', async () => {
    const { delegate } = fakeSettings([{}]);
    await writeRapiCharacter('う'.repeat(MAX_RAPI_PROFILE_LENGTH + 500), delegate);
    expect((await readRapiCharacter(delegate))?.length).toBe(MAX_RAPI_PROFILE_LENGTH);
  });

  test('is null when the row cannot be read', async () => {
    expect(await readRapiCharacter(brokenSettings)).toBeNull();
  });
});
