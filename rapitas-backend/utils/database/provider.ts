/**
 * Database Provider Utilities
 *
 * Single source of truth for detecting the active Prisma database provider.
 * `mode: 'insensitive'` is a PostgreSQL-only StringFilter option; SQLite's
 * generated Prisma client has no `mode` field, so queries including it throw
 * PrismaClientValidationError at runtime on the desktop (Tauri/SQLite) build.
 */

/**
 * Returns true when the active database provider is PostgreSQL.
 *
 * Detection order:
 * 1. `RAPITAS_DB_PROVIDER === 'sqlite'` → false
 * 2. `DATABASE_URL` starts with `file:` → false (SQLite file-based URL)
 * 3. Otherwise → true (PostgreSQL is the default)
 *
 * @returns Whether the current provider supports PostgreSQL-only query options.
 */
export function isPostgres(): boolean {
  if (process.env.RAPITAS_DB_PROVIDER === 'sqlite') return false;
  if (process.env.DATABASE_URL?.startsWith('file:')) return false;
  return true;
}

/**
 * Returns `{ mode: 'insensitive' }` for PostgreSQL, or `{}` for SQLite.
 *
 * Spread this into a Prisma `contains` filter to enable case-insensitive
 * search on PostgreSQL while remaining compatible with the SQLite client:
 *
 * ```ts
 * { title: { contains: term, ...insensitiveMode() } }
 * ```
 *
 * @returns A Prisma-compatible mode fragment, or an empty object for SQLite.
 */
export function insensitiveMode(): Record<string, unknown> {
  return isPostgres() ? { mode: 'insensitive' } : {};
}
