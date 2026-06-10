/**
 * PrismaHelpers
 *
 * Cross-provider utilities for Prisma query construction.
 * Centralises the `mode: 'insensitive'` guard so all callers share one source of truth.
 * Not responsible for Prisma client initialisation or connection management.
 */

/**
 * Returns true when the active database provider is PostgreSQL.
 *
 * Uses a double-condition so the result is correct whether RAPITAS_DB_PROVIDER
 * is set or not — a `file:` DATABASE_URL unambiguously signals SQLite even when
 * the env var is absent (e.g. in some desktop build environments).
 * Mirrors the logic in `config/desktop-sqlite.ts:isDesktopSqlite()`.
 *
 * NOTE: Must NOT cache across calls. Tests manipulate `process.env` between cases;
 * caching at module-load time would cause cross-test contamination.
 *
 * @returns true when Postgres is the active provider, false when SQLite
 *          / PostgreSQLが有効な場合 true、SQLiteの場合 false
 */
export function isPostgresProvider(): boolean {
  return (
    process.env.RAPITAS_DB_PROVIDER !== 'sqlite' &&
    !process.env.DATABASE_URL?.startsWith('file:')
  );
}

/**
 * Returns the Prisma `StringFilter` fragment for case-insensitive matching.
 *
 * Spreads safely into any string filter:
 *   `{ contains: term, ...caseInsensitive() }`
 *
 * On SQLite the returned object is empty so the `mode` key is absent,
 * preventing `PrismaClientValidationError` on the desktop-generated client.
 *
 * @returns `{ mode: 'insensitive' }` on Postgres, `{}` on SQLite
 *          / Postgres では `{ mode: 'insensitive' }`、SQLite では `{}`
 */
export function caseInsensitive(): { mode: 'insensitive' } | Record<string, never> {
  return isPostgresProvider() ? ({ mode: 'insensitive' } as const) : {};
}
