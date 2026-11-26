/**
 * desktop-sqlite-indexes
 *
 * Helpers for applying the init SQL's CREATE INDEX statements to an existing
 * desktop SQLite database. It does not decide which indexes the schema wants;
 * that stays with the generated init SQL.
 */

/**
 * Matches a Prisma-emitted index statement, with or without `IF NOT EXISTS`.
 * Groups: 1 = `UNIQUE ` (optional), 2 = index name, 3 = target table.
 */
export const CREATE_INDEX_PATTERN =
  /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"\s+ON\s+"([^"]+)"/i;

/**
 * Rewrites a `CREATE INDEX` statement to `CREATE INDEX IF NOT EXISTS`.
 *
 * Prisma never emits IF NOT EXISTS and CI requires the generated file to match
 * Prisma's output, so the idempotency is added at apply time instead.
 *
 * @param stmt - A single CREATE INDEX statement / CREATE INDEX 文
 * @returns The same statement that tolerates an existing index / 既存索引を許容する文
 */
export function toIdempotentIndexSql(stmt: string): string {
  return stmt.replace(
    /^(CREATE\s+(?:UNIQUE\s+)?INDEX)\s+(?!IF\s+NOT\s+EXISTS)/i,
    '$1 IF NOT EXISTS ',
  );
}

/**
 * Lists the declared index names that are absent from the database.
 *
 * Index creation failures are otherwise swallowed at startup; this makes a
 * missing index visible to the caller so it can warn.
 *
 * @param database - Open SQLite database / オープン中の SQLite データベース
 * @param initSql - The generated init SQL / 生成された init SQL
 * @param names - Index names that must exist / 存在すべき索引名
 * @returns Names declared in the init SQL but missing from sqlite_master / 欠けている索引名
 */
export function findMissingIndexes(
  database: import('bun:sqlite').Database,
  initSql: string,
  names: readonly string[],
): string[] {
  const live = new Set(
    (
      database.query("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name),
  );
  return names.filter((n) => initSql.includes(`"${n}"`) && !live.has(n));
}

/**
 * Indexes added for task 1560 (hot completedAt / session / timeline lookups).
 * Verified after every startup apply because a failed CREATE INDEX is silent.
 */
export const TASK_1560_INDEXES = [
  'AgentExecution_sessionId_idx',
  'AgentExecution_completedAt_idx',
  'AgentSession_configId_idx',
  'TimelineEvent_eventType_createdAt_idx',
] as const;
