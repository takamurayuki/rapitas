/**
 * Database Provider Detection
 *
 * Canonical source for DB provider detection. All DB-provider-conditional
 * logic must use these exports instead of inline env-var checks.
 */

/** The set of supported database providers. */
export type DbProvider = 'postgresql' | 'sqlite';

/**
 * Detect the active DB provider from environment variables.
 *
 * Priority order:
 *   1. `RAPITAS_DB_PROVIDER` if it is explicitly `sqlite` or `postgres(ql)`.
 *   2. `DATABASE_URL` prefix — `file:` → sqlite, `postgres` → postgresql.
 *   3. Default to `'postgresql'` (production assumption).
 *
 * NOTE: Reads `process.env` on every call — intentionally NOT cached at
 * module load time so that tests can override env vars between invocations.
 *
 * @returns The detected DB provider / 検出された DB プロバイダ
 */
export function getDbProvider(): DbProvider {
  const explicit = process.env.RAPITAS_DB_PROVIDER?.toLowerCase();
  if (explicit === 'sqlite') return 'sqlite';
  if (explicit === 'postgres' || explicit === 'postgresql') return 'postgresql';

  const url = process.env.DATABASE_URL;
  if (url?.startsWith('file:')) return 'sqlite';
  if (url?.startsWith('postgres')) return 'postgresql';

  return 'postgresql';
}

/**
 * Return the Prisma `mode: 'insensitive'` fragment when the active provider
 * is PostgreSQL, or an empty object for SQLite.
 *
 * PostgreSQL supports case-insensitive `contains` via `mode: 'insensitive'`.
 * The SQLite Prisma client omits `mode` from StringFilter entirely, so
 * passing it raises `PrismaClientValidationError` at runtime.
 *
 * Spread the return value directly into a Prisma `StringFilter`:
 * `{ contains: word, ...getInsensitiveMode() }`
 *
 * @returns `{ mode: 'insensitive' }` for PostgreSQL, `{}` for SQLite
 */
export function getInsensitiveMode(): { mode: 'insensitive' } | Record<string, never> {
  return getDbProvider() === 'postgresql' ? { mode: 'insensitive' as const } : {};
}
