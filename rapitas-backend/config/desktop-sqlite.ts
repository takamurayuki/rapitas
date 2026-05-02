import { dirname, resolve } from 'path';
import { mkdir } from 'fs/promises';
import { createLogger } from './logger';
import { SQLITE_INIT_SQL } from '../src/generated/sqlite-init-sql';
import { repairCorruptedDecimals } from '../scripts/repair-corrupted-decimals';

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

    // Self-heal missing tables. Previously this only ran the init SQL when
    // the `User` table was absent (first-run gate), which left existing
    // databases stuck without any new tables added in later commits — e.g.
    // `WorkflowTransition`, where `prisma.workflowTransition.create()` then
    // failed with `The table 'main.WorkflowTransition' does not exist`.
    //
    // Now we list every `CREATE TABLE "X"` statement in the init SQL,
    // diff that against `sqlite_master`, and exec ONLY the statements
    // whose target table is missing. Indexes for those tables are picked
    // up automatically because they appear interleaved with the
    // CREATE TABLE blocks. Running CREATE INDEX twice on an existing
    // table is benign — sqlite errors with `index already exists`, which
    // we swallow.
    const existingTables = new Set<string>(
      (
        database.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
          name: string;
        }>
      ).map((r) => r.name),
    );

    if (!existingTables.has('User')) {
      // First run: clean slate, just exec everything.
      database.exec(SQLITE_INIT_SQL);
      log.info({ databasePath }, 'Desktop SQLite database initialised from init SQL');
    } else {
      const statements = splitInitSqlIntoStatements(SQLITE_INIT_SQL);
      let createdTables = 0;
      let skippedTables = 0;
      let createdIndexes = 0;
      let indexErrors = 0;
      for (const stmt of statements) {
        const tableMatch = stmt.match(/^CREATE TABLE\s+"([^"]+)"/i);
        if (tableMatch) {
          const tableName = tableMatch[1];
          if (existingTables.has(tableName)) {
            skippedTables++;
            continue;
          }
          try {
            database.exec(stmt);
            existingTables.add(tableName);
            createdTables++;
            log.info({ databasePath, table: tableName }, 'Created missing SQLite table');
          } catch (err) {
            log.warn(
              { err, table: tableName },
              'Failed to create missing SQLite table (continuing)',
            );
          }
          continue;
        }
        const indexMatch = stmt.match(/^CREATE\s+(UNIQUE\s+)?INDEX\s+"([^"]+)"\s+ON\s+"([^"]+)"/i);
        if (indexMatch) {
          // Only create the index when its target table is one we just
          // created. For tables that already existed, their indexes also
          // already existed.
          const targetTable = indexMatch[3];
          if (!existingTables.has(targetTable)) continue;
          try {
            database.exec(stmt);
            createdIndexes++;
          } catch {
            // intentionally ignore - index already exists or other constraint error
            indexErrors++;
          }
        }
      }
      if (createdTables > 0 || createdIndexes > 0) {
        log.info(
          { databasePath, createdTables, skippedTables, createdIndexes, indexErrors },
          'Desktop SQLite database self-healed missing tables',
        );
      } else {
        log.info({ databasePath, skippedTables }, 'Desktop SQLite database is up to date');
      }
    }

    log.info({ databasePath }, 'Desktop SQLite database is ready');
  } finally {
    database.close();
  }

  // Startup auto-repair: scan AgentExecution for double-JSON-encoded
  // costUsd / token values left behind by old IPC bugs. Without this the
  // dashboard's `/agent-metrics/observation` endpoint returns
  // "Failed to fetch self-observation summary" because the Prisma SQLite
  // Decimal deserializer can't parse `"\"0\""` (a JSON string containing
  // another JSON string). Repairs in-place and is idempotent — runs on
  // every startup, costs ~ms when nothing needs fixing.
  try {
    const stats = repairCorruptedDecimals(databasePath);
    if (stats.costUsdRepaired > 0 || stats.tokenColsRepaired > 0) {
      log.warn(
        { databasePath, ...stats },
        'Repaired corrupted Decimal / token columns on AgentExecution',
      );
    } else if (stats.scanned > 0) {
      log.info(
        { databasePath, scanned: stats.scanned },
        'AgentExecution decimal/token columns scanned — no corruption found',
      );
    }
  } catch (repairErr) {
    log.warn(
      { err: repairErr, databasePath },
      'Decimal repair on startup failed (non-fatal); dashboard endpoint may still error',
    );
  }
}

/**
 * Split the multi-statement init SQL into individual statements so we can
 * execute only the ones for missing tables. The generator output uses
 * `;` as a terminator and never embeds semicolons inside string literals
 * (Prisma migration diff is well-behaved this way).
 *
 * Each chunk Prisma emits looks like:
 *   `-- CreateTable\nCREATE TABLE "X" (...)\n`
 * so we ALSO strip leading `-- ...` comment lines from each chunk before
 * returning it. Without this strip, the caller's `^CREATE TABLE` regex
 * never matches and the self-heal silently does nothing — the exact
 * regression that left `WorkflowTransition` missing on existing dev DBs.
 */
function splitInitSqlIntoStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((chunk) => {
      // Drop leading comment-only lines so the actual DDL is at the start.
      const lines = chunk.split('\n');
      while (lines.length > 0 && /^\s*(--|$)/.test(lines[0])) lines.shift();
      return lines.join('\n').trim();
    })
    .filter((s) => s.length > 0);
}
