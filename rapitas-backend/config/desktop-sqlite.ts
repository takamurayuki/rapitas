import { dirname, resolve } from 'path';
import { mkdir } from 'fs/promises';
import { createLogger } from './logger';
import { SQLITE_INIT_SQL } from '../src/generated/sqlite-init-sql';

const log = createLogger('desktop-sqlite');

function isDesktopSqlite(): boolean {
  return (
    process.env.RAPITAS_DB_PROVIDER === 'sqlite' ||
    (process.env.TAURI_BUILD === 'true' && process.env.DATABASE_URL?.startsWith('file:') === true)
  );
}

function sqlitePathFromDatabaseUrl(databaseUrl: string): string {
  const rawPath = databaseUrl.replace(/^file:/, '');
  return resolve(rawPath);
}

export async function ensureDesktopSqliteDatabase(): Promise<void> {
  if (!isDesktopSqlite()) return;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.startsWith('file:')) {
    throw new Error('Desktop SQLite mode requires DATABASE_URL to start with file:');
  }

  if (!SQLITE_INIT_SQL.trim()) {
    throw new Error('SQLite init SQL is empty. Run bun run db:prepare:sqlite before building.');
  }

  const { Database } = await import('bun:sqlite');
  const databasePath = sqlitePathFromDatabaseUrl(databaseUrl);

  await mkdir(dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);

  try {
    database.exec('PRAGMA journal_mode = WAL;');
    database.exec('PRAGMA foreign_keys = ON;');

    const existingUserTable = database
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'User'")
      .get();
    if (!existingUserTable) {
      database.exec(SQLITE_INIT_SQL);
    }

    log.info({ databasePath }, 'Desktop SQLite database is ready');
  } finally {
    database.close();
  }
}
