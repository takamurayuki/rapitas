/**
 * Prisma Client Resolver
 *
 * Picks the generated Prisma client (postgres vs sqlite) matching the
 * current process's DATABASE_URL. Split out of `database.ts` so a second
 * call site that needs its OWN `new PrismaClient(...)` instance (e.g.
 * `workers/agent-worker.ts`, which passes custom `log` options) can resolve
 * the correct constructor WITHOUT importing `database.ts` itself — that
 * module's top-level code eagerly builds and exports a `prisma` singleton,
 * which would be an unused, wasted second instance in the worker process.
 */
import { resolve } from 'path';
import type { PrismaClient as PrismaClientType } from '../generated/prisma-postgres';
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

export const isSqlite = process.env.DATABASE_URL?.startsWith('file:') ?? false;
export const dbProvider = isSqlite ? 'SQLite' : 'PostgreSQL';

/**
 * Resolves the Prisma `PrismaClient` constructor matching the CURRENT
 * process's DATABASE_URL (postgres vs sqlite).
 *
 * @returns The `PrismaClient` class for the active provider. / 現在のプロバイダに対応するPrismaClientクラス
 */
export function resolvePrismaClientCtor(): typeof PrismaClientType {
  // NOTE: The postgres and sqlite schemas each generate to their OWN folder
  // (see prisma/schema/_generators.prisma's `output`) instead of the shared
  // default `node_modules/.prisma/client` — running the postgres dev backend
  // and the desktop (SQLite) dev/build at the same time no longer makes one
  // overwrite the other's client. Pick the matching one for THIS process at
  // runtime; the type import above (postgres) is structurally identical
  // between the two schemas, so it's safe to use for both at compile time.
  const { PrismaClient } = (
    isSqlite ? require('../generated/prisma-sqlite') : require('../generated/prisma-postgres')
  ) as { PrismaClient: typeof PrismaClientType };
  return PrismaClient;
}
