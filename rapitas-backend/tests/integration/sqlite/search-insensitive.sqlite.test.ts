/**
 * search-insensitive.sqlite.test.ts
 *
 * Verifies that the mode:'insensitive' removal code path works correctly on
 * SQLite. Specifically:
 *   1. getInsensitiveMode() returns {} (not { mode:'insensitive' }) when
 *      RAPITAS_DB_PROVIDER=sqlite is set.
 *   2. A direct SQLite Prisma query using contains (no mode) works without
 *      throwing PrismaClientValidationError.
 *
 * Skipped by default — activated by RAPITAS_TEST_SQLITE=1 (set by `bun run test:sqlite`).
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

const SQLITE_TEST = process.env.RAPITAS_TEST_SQLITE === '1';

describe.skipIf(!SQLITE_TEST)('SQLite insensitive-mode removal', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let testPrisma: any;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    const { createSqliteTestDb } = await import('./sqlite-test-db.ts');
    const db = await createSqliteTestDb('search');
    testPrisma = db.prisma;
    dispose = db.dispose;

    // Seed lowercase-only task titles (SQLite LIKE is case-insensitive for ASCII,
    // so we keep data deterministic by using lowercase consistently).
    await testPrisma.task.create({
      data: { title: 'sqlite search alpha', status: 'todo', priority: 'medium' },
    });
    await testPrisma.task.create({
      data: { title: 'sqlite search beta', status: 'todo', priority: 'low' },
    });
    await testPrisma.task.create({
      data: { title: 'unrelated task', status: 'todo', priority: 'low' },
    });
  });

  afterAll(async () => {
    if (dispose) await dispose();
  });

  test('getInsensitiveMode returns {} for SQLite provider', async () => {
    // RAPITAS_DB_PROVIDER=sqlite is set by the test:sqlite npm script.
    const { getInsensitiveMode } = await import('../../../config/db-provider.ts');
    const mode = getInsensitiveMode();
    expect(mode).toEqual({});
  });

  test('SQLite Prisma contains query succeeds without mode:insensitive', async () => {
    // If mode:'insensitive' were passed to the SQLite client it would throw
    // PrismaClientValidationError. This test verifies the happy path.
    const tasks = await testPrisma.task.findMany({
      where: { title: { contains: 'sqlite search' } },
    });
    expect(tasks).toHaveLength(2);
  });

  test('contains matches only tasks with the search term', async () => {
    const tasks = await testPrisma.task.findMany({
      where: { title: { contains: 'alpha' } },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('sqlite search alpha');
  });
});
