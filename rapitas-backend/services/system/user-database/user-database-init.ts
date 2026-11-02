/**
 * user-database-init
 *
 * The two things done to a user's own database before switching to it
 * (#1285): measure the round trip, and apply the schema — explicitly, once,
 * never as part of startup. Not responsible for storing the URL or switching
 * (user-database-store / config/user-database-override).
 */
import { POSTGRES_INIT_SQL } from '../../../src/generated/postgres-init-sql';

/** The slice of a Prisma client this module uses. */
export interface PgClient {
  $queryRawUnsafe<T = unknown>(sql: string): Promise<T>;
  $executeRawUnsafe(sql: string): Promise<number>;
  $transaction(ops: Promise<unknown>[]): Promise<unknown>;
  $disconnect(): Promise<void>;
}

/** Opens a client against one URL — the generated postgres client by default. */
export type PgClientFactory = (url: string) => PgClient;

/** A dedicated client for the user's URL, never the app's own singleton. */
export const defaultPgClientFactory: PgClientFactory = (url) => {
  const { PrismaClient } = require('../../../generated/prisma-postgres') as {
    PrismaClient: new (o: { datasourceUrl: string }) => PgClient;
  };
  return new PrismaClient({ datasourceUrl: url });
};

/** Round-trip measurement of a database. */
export interface LatencyReport {
  samples: number;
  medianMs: number;
  p90Ms: number;
  /** Whether rapitas tables already exist there. */
  hasSchema: boolean;
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;

/** Whether the "Task" table exists in the connected schema. */
async function hasRapitasSchema(client: PgClient): Promise<boolean> {
  const rows = await client.$queryRawUnsafe<Array<{ exists: string | null }>>(
    `SELECT to_regclass('"Task"')::text AS exists`,
  );
  return rows[0]?.exists != null;
}

/**
 * Measure `SELECT 1` round trips — the per-query floor every screen pays.
 *
 * @param url - Connection string / 接続文字列
 * @param factory - Client factory (injectable) / クライアント生成
 * @param samples - How many round trips / 計測回数
 * @returns Median / p90 and whether the schema is there / 計測結果
 */
export async function measureLatency(
  url: string,
  factory: PgClientFactory = defaultPgClientFactory,
  samples = 10,
): Promise<LatencyReport> {
  const client = factory(url);
  try {
    await client.$queryRawUnsafe('SELECT 1'); // connect + warm up, not counted
    const times: number[] = [];
    for (let i = 0; i < samples; i++) {
      const t0 = performance.now();
      await client.$queryRawUnsafe('SELECT 1');
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const round = (n: number) => Math.round(n * 10) / 10;
    return {
      samples,
      medianMs: round(percentile(times, 50)),
      p90Ms: round(percentile(times, 90)),
      hasSchema: await hasRapitasSchema(client),
    };
  } finally {
    await client.$disconnect();
  }
}

/** Split generated DDL into statements (Prisma's output: one per `;` line end). */
export function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => s.length > 0);
}

/**
 * Apply the schema to an EMPTY database, all or nothing.
 *
 * Refuses when rapitas tables already exist: re-running DDL over a database
 * with data is how data gets lost, and this action is meant to run once.
 *
 * @param url - Connection string / 接続文字列
 * @param factory - Client factory (injectable) / クライアント生成
 * @returns ok with the statement count, or why it refused / 結果
 */
export async function initializeUserDatabase(
  url: string,
  factory: PgClientFactory = defaultPgClientFactory,
): Promise<{ ok: true; statements: number } | { ok: false; reason: 'not_empty' }> {
  const client = factory(url);
  try {
    if (await hasRapitasSchema(client)) return { ok: false, reason: 'not_empty' };
    const statements = splitStatements(POSTGRES_INIT_SQL);
    // One transaction: a failure halfway leaves the database as it was.
    await client.$transaction(statements.map((s) => client.$executeRawUnsafe(s)));
    return { ok: true, statements: statements.length };
  } finally {
    await client.$disconnect();
  }
}
