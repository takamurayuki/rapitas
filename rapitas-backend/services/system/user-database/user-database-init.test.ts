/**
 * user-database-init tests (#1285)
 *
 * Unit level, with a fake client: initialize refuses a database that already
 * has rapitas tables, applies everything in one transaction otherwise, and
 * every path disconnects. The real-PostgreSQL run is the integration test.
 */
import { describe, test, expect, mock } from 'bun:test';
import {
  initializeUserDatabase,
  measureLatency,
  splitStatements,
  type PgClient,
} from './user-database-init';
import { POSTGRES_INIT_SQL } from '../../../src/generated/postgres-init-sql';

function fakeClient(hasTask: boolean) {
  const executed: string[] = [];
  const client = {
    $queryRawUnsafe: mock(async (sql: string) =>
      sql.includes('to_regclass') ? [{ exists: hasTask ? 'Task' : null }] : [{ '?column?': 1 }],
    ),
    $executeRawUnsafe: mock(async (sql: string) => {
      executed.push(sql);
      return 0;
    }),
    $transaction: mock(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    $disconnect: mock(async () => {}),
  };
  return { client: client as unknown as PgClient & typeof client, executed };
}

describe('splitStatements', () => {
  test('splits the generated DDL into executable statements with no comments', () => {
    const s = splitStatements(POSTGRES_INIT_SQL);
    expect(s.length).toBeGreaterThan(100);
    expect(s.filter((x) => x.startsWith('CREATE TABLE')).length).toBeGreaterThanOrEqual(100);
    expect(s.some((x) => x.trim().startsWith('--'))).toBe(false);
  });
});

describe('initializeUserDatabase', () => {
  test('refuses a database that already has the schema, executing nothing', async () => {
    const { client, executed } = fakeClient(true);
    expect(await initializeUserDatabase('postgres://u:p@h/db', () => client)).toEqual({
      ok: false,
      reason: 'not_empty',
    });
    expect(executed).toEqual([]);
    expect(client.$disconnect).toHaveBeenCalled();
  });

  test('applies every statement in one transaction', async () => {
    const { client, executed } = fakeClient(false);
    const r = await initializeUserDatabase('postgres://u:p@h/db', () => client);
    expect(r.ok).toBe(true);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(executed.length).toBe(splitStatements(POSTGRES_INIT_SQL).length);
    expect(client.$disconnect).toHaveBeenCalled();
  });
});

describe('measureLatency', () => {
  test('reports samples, median/p90 and whether the schema exists; disconnects', async () => {
    const { client } = fakeClient(false);
    const r = await measureLatency('postgres://u:p@h/db', () => client, 5);
    expect(r.samples).toBe(5);
    expect(r.medianMs).toBeGreaterThanOrEqual(0);
    expect(r.p90Ms).toBeGreaterThanOrEqual(r.medianMs);
    expect(r.hasSchema).toBe(false);
    expect(client.$disconnect).toHaveBeenCalled();
  });
});
