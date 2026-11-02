/**
 * user-database-init integration test (#1285)
 *
 * Against a REAL PostgreSQL (the CI service): create a throwaway database,
 * initialize it with the generated DDL, prove the tables exist, prove a second
 * initialize refuses, and drop it. Skips — saying why — when no PostgreSQL is
 * reachable, so a laptop without one does not read as a failure.
 */
import { describe, test, expect, afterAll } from 'bun:test';
import {
  initializeUserDatabase,
  measureLatency,
  defaultPgClientFactory,
} from './user-database-init';

const base = process.env.DATABASE_URL ?? '';
const dbName = `rapitas_byo_${process.pid}_${Date.now() % 100000}`;

async function reachable(): Promise<boolean> {
  if (!/^postgres(ql)?:\/\//.test(base)) return false;
  const client = defaultPgClientFactory(base);
  try {
    await Promise.race([
      client.$queryRawUnsafe('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

const available = await reachable();
const target = (() => {
  if (!available) return '';
  const u = new URL(base);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

if (!available) {
  // NOTE: Where a job promises a PostgreSQL service (RAPITAS_REQUIRE_PG_INTEGRATION=1,
  // set on the gate step that runs one), an unreachable database is a broken
  // service, not a reason to skip — a skip there would be a green gate that
  // measured nothing. Other CI jobs carry a placeholder postgres URL with no
  // server behind it (the shuffle job), so `CI=true` alone cannot decide this.
  if (process.env.RAPITAS_REQUIRE_PG_INTEGRATION === '1') {
    throw new Error(
      '[user-database-init.integration] CI PostgreSQL in DATABASE_URL is unreachable',
    );
  }
  console.warn('[user-database-init.integration] skipped: no reachable PostgreSQL in DATABASE_URL');
}

describe.skipIf(!available)('initializeUserDatabase against PostgreSQL', () => {
  afterAll(async () => {
    const admin = defaultPgClientFactory(base);
    await admin
      .$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
      .catch(() => {});
    await admin.$disconnect();
  });

  test('creates the schema in an empty database, then refuses to run again', async () => {
    const admin = defaultPgClientFactory(base);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    await admin.$disconnect();

    const before = await measureLatency(target, defaultPgClientFactory, 3);
    expect(before.hasSchema).toBe(false);

    const first = await initializeUserDatabase(target);
    expect(first.ok).toBe(true);

    const after = await measureLatency(target, defaultPgClientFactory, 3);
    expect(after.hasSchema).toBe(true);

    expect(await initializeUserDatabase(target)).toEqual({ ok: false, reason: 'not_empty' });
  }, 120_000);
});
