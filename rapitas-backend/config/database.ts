/**
 * Database Configuration
 *
 * Prisma client initialization. Supports PostgreSQL (web) and SQLite (desktop)
 * selected by DATABASE_URL.
 */
import type { PrismaClient as PrismaClientType } from '../generated/prisma-postgres';
import { resolve } from 'path';
import { createLogger } from './logger';

const log = createLogger('database');

/**
 * Rewrites a relative SQLite `file:` DATABASE_URL to an absolute path before the
 * client is constructed.
 *
 * NOTE: Prisma resolves a relative `file:` path against the schema-folder
 * directory, whereas ensureDesktopSqliteDatabase resolves it against
 * process.cwd(). A relative DATABASE_URL therefore made the initializer and the
 * client target DIFFERENT files — leaving the client on an empty DB that throws
 * `The table 'main.X' does not exist`. Making it absolute forces both to agree.
 * No-op for absolute file: paths and for postgres URLs, so production (dev.js
 * passes an absolute path) is unaffected.
 */
function normalizeSqliteDatabaseUrl(): void {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith('file:')) return;
  const rawPath = url.slice('file:'.length);
  // Already absolute (POSIX `/...` or Windows `C:\...` / `C:/...`).
  if (rawPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rawPath)) return;
  process.env.DATABASE_URL = `file:${resolve(rawPath)}`;
  log.warn(
    { from: url, to: process.env.DATABASE_URL },
    'Normalized relative SQLite DATABASE_URL to an absolute path so init and Prisma agree',
  );
}

normalizeSqliteDatabaseUrl();

const isSqlite = process.env.DATABASE_URL?.startsWith('file:') ?? false;
const dbProvider = isSqlite ? 'SQLite' : 'PostgreSQL';
log.info(`Connecting to ${dbProvider}`);

// NOTE: The postgres and sqlite schemas each generate to their OWN folder
// (see prisma/schema/_generators.prisma's `output`) instead of the shared
// default `node_modules/.prisma/client` — running the postgres dev backend
// and the desktop (SQLite) dev/build at the same time no longer makes one
// overwrite the other's client. Pick the matching one for THIS process at
// runtime; the type import above (postgres) is structurally identical
// between the two schemas, so it's safe to use for both at compile time.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime provider selection can't be a static import
const { PrismaClient } = (
  isSqlite ? require('../generated/prisma-sqlite') : require('../generated/prisma-postgres')
) as { PrismaClient: typeof PrismaClientType };

export const prisma = new PrismaClient();

/**
 * Verify DB connection and retry until successful.
 * Called before server startup to prevent receiving requests while DB is disconnected.
 */
export async function ensureDatabaseConnection(maxRetries = 5, retryDelayMs = 1000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$connect();
      log.info(`${dbProvider} connection established`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === maxRetries) {
        log.error(
          { err: error, maxRetries },
          `Failed to connect after ${maxRetries} attempts: ${message}`,
        );
        throw error;
      }
      log.warn(
        { attempt, maxRetries, retryDelayMs },
        `Connection attempt ${attempt}/${maxRetries} failed: ${message}. Retrying in ${retryDelayMs}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}
