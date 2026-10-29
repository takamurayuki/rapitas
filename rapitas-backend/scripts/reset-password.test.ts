/**
 * reset-password integration
 *
 * Runs the real reset against a throwaway SQLite database, because the part
 * that can silently do nothing is the SQL: a mistyped column name would leave
 * the operator with a printed password that does not work, and no error.
 *
 * The decisive assertion is the last one — the stored hash verifies against
 * the new password using the same bcrypt call the login route makes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { resetUserPassword } from '../services/core/password-reset';
import { sqliteResetDb, resolveDatabasePath, run } from './reset-password';

let dir: string;
let dbPath: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reset-pw-'));
  dbPath = join(dir, 'test.db');
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE "User" (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      passwordHash TEXT
    );
    CREATE TABLE "UserSession" (
      id INTEGER PRIMARY KEY,
      userId INTEGER,
      sessionToken TEXT
    );
  `);
  db.query('INSERT INTO "User" (id, username, email, passwordHash) VALUES (?, ?, ?, ?)').run(
    1,
    'yuki',
    'yuki@example.test',
    'the-old-hash',
  );
  db.query('INSERT INTO "User" (id, username, email, passwordHash) VALUES (?, ?, ?, ?)').run(
    2,
    'other',
    'other@example.test',
    'untouched',
  );
  for (const token of ['a', 'b']) {
    db.query('INSERT INTO "UserSession" (userId, sessionToken) VALUES (?, ?)').run(1, token);
  }
  db.query('INSERT INTO "UserSession" (userId, sessionToken) VALUES (?, ?)').run(2, 'c');
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const fast = (pw: string): Promise<string> => Promise.resolve(`h:${pw}`);

describe('against a real database', () => {
  it('finds the account by username and rewrites its hash', async () => {
    const result = await resetUserPassword({
      identifier: 'yuki',
      password: 'a-new-password',
      db: sqliteResetDb(db),
      hash: fast,
    });

    const row = db.query('SELECT passwordHash FROM "User" WHERE id = 1').get() as {
      passwordHash: string;
    };
    expect(result.username).toBe('yuki');
    expect(row.passwordHash).toBe('h:a-new-password');
  });

  it('finds the same account by email', async () => {
    const result = await resetUserPassword({
      identifier: 'yuki@example.test',
      password: 'a-new-password',
      db: sqliteResetDb(db),
      hash: fast,
    });

    expect(result.userId).toBe(1);
  });

  it('deletes only that user’s sessions, and counts them', async () => {
    const result = await resetUserPassword({
      identifier: 'yuki',
      password: 'a-new-password',
      db: sqliteResetDb(db),
      hash: fast,
    });

    expect(result.revokedSessions).toBe(2);
    const left = db.query('SELECT userId FROM "UserSession"').all() as { userId: number }[];
    expect(left).toEqual([{ userId: 2 }]);
  });

  it('leaves every other account alone', async () => {
    await resetUserPassword({
      identifier: 'yuki',
      password: 'a-new-password',
      db: sqliteResetDb(db),
      hash: fast,
    });

    const other = db.query('SELECT passwordHash FROM "User" WHERE id = 2').get() as {
      passwordHash: string;
    };
    expect(other.passwordHash).toBe('untouched');
  });

  it('writes a hash the login route will accept', async () => {
    // The whole point of the tool: the password it prints must actually work.
    // Real bcrypt here, at the cost factor registration uses.
    await resetUserPassword({
      identifier: 'yuki',
      password: 'a-new-password',
      db: sqliteResetDb(db),
      hash: (pw) => bcrypt.hash(pw, 12),
    });

    const row = db.query('SELECT passwordHash FROM "User" WHERE id = 1').get() as {
      passwordHash: string;
    };
    expect(await bcrypt.compare('a-new-password', row.passwordHash)).toBe(true);
    expect(await bcrypt.compare('the-old-password', row.passwordHash)).toBe(false);
  });

  it('refuses an unknown account without touching a row', async () => {
    await expect(
      resetUserPassword({
        identifier: 'nobody',
        password: 'a-new-password',
        db: sqliteResetDb(db),
      }),
    ).rejects.toThrow('no account');

    const row = db.query('SELECT passwordHash FROM "User" WHERE id = 1').get() as {
      passwordHash: string;
    };
    expect(row.passwordHash).toBe('the-old-hash');
    expect(db.query('SELECT COUNT(*) AS n FROM "UserSession"').get()).toEqual({ n: 3 });
  });
});

describe('the CLI', () => {
  it('generates a working password when none is given', async () => {
    process.env.RAPITAS_RESET_DB = dbPath;
    try {
      const lines = await run(['yuki']);
      const printed = lines.find((l) => l.startsWith('new password'))?.split(': ')[1] ?? '';

      expect(printed.length).toBeGreaterThanOrEqual(8);
      const row = db.query('SELECT passwordHash FROM "User" WHERE id = 1').get() as {
        passwordHash: string;
      };
      expect(await bcrypt.compare(printed, row.passwordHash)).toBe(true);
    } finally {
      delete process.env.RAPITAS_RESET_DB;
    }
  });

  it('explains itself rather than failing obscurely with no argument', async () => {
    await expect(run([])).rejects.toThrow('usage:');
  });
});

describe('resolveDatabasePath', () => {
  const saved = { reset: process.env.RAPITAS_RESET_DB, url: process.env.DATABASE_URL };

  afterEach(() => {
    if (saved.reset === undefined) delete process.env.RAPITAS_RESET_DB;
    else process.env.RAPITAS_RESET_DB = saved.reset;
    if (saved.url === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved.url;
  });

  it('prefers an explicit override', () => {
    process.env.RAPITAS_RESET_DB = dbPath;
    process.env.DATABASE_URL = 'file:./somewhere-else.db';
    expect(resolveDatabasePath()).toBe(dbPath);
  });

  it('accepts a file: DATABASE_URL', () => {
    delete process.env.RAPITAS_RESET_DB;
    process.env.DATABASE_URL = `file:${dbPath}`;
    expect(resolveDatabasePath()).toBe(dbPath);
  });

  it('ignores a postgres DATABASE_URL and falls back to the desktop database', () => {
    // The repo's own .env names PostgreSQL while the desktop app runs SQLite;
    // treating that URL as a path would open a junk file and report success.
    delete process.env.RAPITAS_RESET_DB;
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/rapitas';
    expect(resolveDatabasePath(dbPath)).toBe(dbPath);
  });

  it('says what it looked for when there is nothing to open', () => {
    delete process.env.RAPITAS_RESET_DB;
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/rapitas';
    expect(() => resolveDatabasePath(join(dir, 'absent.db'))).toThrow('no SQLite database found');
  });
});
