/**
 * reset-password.ts
 *
 * Operator recovery: set a new password for an account on this machine.
 *
 *   bun run scripts/reset-password.ts <username-or-email> [new-password]
 *
 * With no password given it generates one and prints it once. The plaintext is
 * written to stdout and nowhere else — not to a log, not to a file.
 *
 * Talks to the desktop SQLite database directly rather than through Prisma.
 * The repo's .env names PostgreSQL while the desktop app runs SQLite, so
 * importing the shared client here would connect to whichever the ambient
 * environment happened to say and fail (or worse, succeed against the wrong
 * database). Two tables and three statements do not need an ORM.
 *
 * NOT an HTTP route, deliberately: this server answers unauthenticated
 * requests by design, so an endpoint that rewrites credentials would be an
 * account takeover for anyone who can reach the port.
 */
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import {
  resetUserPassword,
  generatePassword,
  type PasswordResetDb,
} from '../services/core/password-reset';

/** Where the desktop app keeps its database, relative to this package. */
const DESKTOP_DB = resolve(
  import.meta.dir,
  '..',
  '..',
  'rapitas-desktop',
  '.data',
  'rapitas-dev.db',
);

/**
 * The database file to act on.
 *
 * An explicit `RAPITAS_RESET_DB` wins, then a `file:` DATABASE_URL, then the
 * desktop app's own database — which is the one an operator running this
 * almost always means.
 *
 * A non-`file:` DATABASE_URL (the repo's .env names PostgreSQL) is ignored
 * rather than treated as a path — opening it would create a junk SQLite file
 * and report success.
 *
 * @param desktopDb - Fallback database, injectable for tests / フォールバック先
 * @returns Path to the SQLite file / SQLiteファイルのパス
 * @throws {Error} When no candidate exists / 候補が存在しない場合
 */
export function resolveDatabasePath(desktopDb: string = DESKTOP_DB): string {
  const explicit = process.env.RAPITAS_RESET_DB;
  if (explicit !== undefined && explicit.trim() !== '') return resolve(explicit.trim());

  const url = process.env.DATABASE_URL ?? '';
  if (url.startsWith('file:')) return resolve(url.slice('file:'.length));

  if (existsSync(desktopDb)) return desktopDb;
  throw new Error(
    `[reset-password] no SQLite database found. Pass RAPITAS_RESET_DB=<path>. Looked for ${desktopDb}`,
  );
}

/**
 * A PasswordResetDb backed by a SQLite handle.
 *
 * Column and table names are the Prisma model names — this schema has no
 * `@@map`, so model name equals table name.
 *
 * @param db - An open SQLite database / 開いたSQLiteデータベース
 * @returns The three operations a reset needs / リセットに必要な3操作
 */
export function sqliteResetDb(db: Database): PasswordResetDb {
  return {
    user: {
      findFirst: async ({ where }) => {
        const identifier = (where.OR[0] as { username: string }).username;
        const row = db
          .query('SELECT id, username FROM "User" WHERE username = ? OR email = ? LIMIT 1')
          .get(identifier, identifier) as { id: number; username: string } | null;
        return row;
      },
      update: async ({ where, data }) => {
        db.query('UPDATE "User" SET "passwordHash" = ? WHERE id = ?').run(
          data.passwordHash,
          where.id,
        );
        return {};
      },
    },
    userSession: {
      deleteMany: async ({ where }) => {
        const before = db
          .query('SELECT COUNT(*) AS n FROM "UserSession" WHERE "userId" = ?')
          .get(where.userId) as { n: number };
        db.query('DELETE FROM "UserSession" WHERE "userId" = ?').run(where.userId);
        return { count: before.n };
      },
    },
  };
}

/**
 * Run the reset described by argv.
 *
 * @param argv - `[identifier, password?]` / 識別子と任意のパスワード
 * @returns Human-readable lines to print / 表示する行
 */
export async function run(argv: string[]): Promise<string[]> {
  const [identifier, given] = argv;
  if (identifier === undefined || identifier.trim() === '') {
    throw new Error('usage: bun run scripts/reset-password.ts <username-or-email> [new-password]');
  }

  const password = given ?? generatePassword();
  const dbPath = resolveDatabasePath();
  const handle = new Database(dbPath);
  try {
    const result = await resetUserPassword({
      identifier,
      password,
      db: sqliteResetDb(handle),
      hash: (pw) => bcrypt.hash(pw, 12),
    });
    return [
      `database      : ${dbPath}`,
      `account       : ${result.username} (id ${result.userId})`,
      `new password  : ${password}`,
      `sessions ended: ${result.revokedSessions}`,
      '',
      'Sign in with this password, then change it from the app.',
    ];
  } finally {
    handle.close();
  }
}

// Only when executed directly, so the test can import the pieces.
if (import.meta.main) {
  run(process.argv.slice(2))
    .then((lines) => {
      for (const line of lines) console.log(line);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
