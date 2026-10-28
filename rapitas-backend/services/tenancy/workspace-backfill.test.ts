/**
 * workspace-backfill unit
 *
 * What SQL the claim sends, and what it does with a model that fails.
 *
 * The behaviour against a real database is pinned by
 * workspace-backfill.integration.test.ts, which needs a SQLite client and so
 * runs in the sqlite gate. That left this module at 0% function coverage in
 * the gate that blocks merges — for the code that rewrote the owner of 209,251
 * rows of live data. These are the parts worth holding still without a
 * database: the statement names only `workspaceId`, and one model's failure
 * does not quietly become a zero.
 */
import { describe, it, expect } from 'bun:test';
import { claimUnownedRows, type RawExecutor } from './workspace-backfill';
import { getOwnedModels } from './owned-models';

/** Records every statement, and can be told to fail for one table. */
function fakeDb(opts: { rowsPerModel?: number; failOn?: string } = {}): {
  db: RawExecutor;
  sql: string[];
} {
  const sql: string[] = [];
  return {
    sql,
    db: {
      $executeRawUnsafe: (statement: string) => {
        sql.push(statement);
        if (opts.failOn !== undefined && statement.includes(`"${opts.failOn}"`)) {
          return Promise.reject(new Error('no such table'));
        }
        return Promise.resolve(opts.rowsPerModel ?? 0);
      },
    },
  };
}

describe('the statement it sends', () => {
  it('names only workspaceId, so @updatedAt is never touched', async () => {
    const { db, sql } = fakeDb();
    await claimUnownedRows(7, db);
    expect(sql.length).toBeGreaterThan(50);
    for (const statement of sql) {
      expect(statement).toMatch(
        /^UPDATE "[A-Za-z][A-Za-z0-9_]*" SET "workspaceId" = 7 WHERE "workspaceId" IS NULL$/,
      );
      // The defect this function exists to avoid: `updateMany` fires
      // @updatedAt, and 53 owned models carry one.
      expect(statement).not.toContain('updatedAt');
    }
  });

  it('covers every owned model, in a stable order', async () => {
    const { db, sql } = fakeDb();
    await claimUnownedRows(1, db);
    const tables = sql.map((s) => s.match(/^UPDATE "([^"]+)"/)?.[1]);
    expect(tables).toEqual([...getOwnedModels()].sort());
  });

  it('only ever touches rows no workspace owns, which is what makes it re-runnable', async () => {
    const { db, sql } = fakeDb();
    await claimUnownedRows(2, db);
    for (const statement of sql) expect(statement).toContain('WHERE "workspaceId" IS NULL');
  });
});

describe('what it reports', () => {
  it('sums the rows it claimed and lists the models that had any', async () => {
    const { db } = fakeDb({ rowsPerModel: 3 });
    const result = await claimUnownedRows(5, db);
    const owned = getOwnedModels().size;
    expect(result.workspaceId).toBe(5);
    expect(result.totalClaimed).toBe(owned * 3);
    expect(result.models).toHaveLength(owned);
    expect(result.failed).toEqual([]);
  });

  it('leaves a model that claimed nothing out of the report', async () => {
    const { db } = fakeDb({ rowsPerModel: 0 });
    const result = await claimUnownedRows(5, db);
    expect(result.models).toEqual([]);
    expect(result.totalClaimed).toBe(0);
  });

  it('reports a failed model instead of counting it as zero', async () => {
    // Silently skipping would leave that model's rows visible to everyone,
    // which is the one outcome worth shouting about. The route turns a
    // non-empty `failed` into HTTP 207.
    const victim = [...getOwnedModels()].sort()[0];
    const { db } = fakeDb({ rowsPerModel: 4, failOn: victim });
    const result = await claimUnownedRows(5, db);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].model).toBe(victim);
    expect(result.failed[0].error).toContain('no such table');
    expect(result.models.some((m) => m.model === victim)).toBe(false);
  });

  it('keeps going after one model fails', async () => {
    const victim = [...getOwnedModels()].sort()[0];
    const { db } = fakeDb({ rowsPerModel: 4, failOn: victim });
    const result = await claimUnownedRows(5, db);
    expect(result.models).toHaveLength(getOwnedModels().size - 1);
  });
});

describe('what it refuses', () => {
  it.each([1.5, NaN, Infinity])(
    'refuses workspace %p rather than interpolating it',
    async (bad) => {
      // The id is interpolated into the statement, so a non-integer is the one
      // input that could change the SQL's shape.
      const { db, sql } = fakeDb();
      await expect(claimUnownedRows(bad, db)).rejects.toThrow('non-integer workspace');
      expect(sql).toEqual([]);
    },
  );
});
