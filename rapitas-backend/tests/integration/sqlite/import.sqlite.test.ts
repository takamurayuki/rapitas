/**
 * import.sqlite.test.ts
 *
 * SQLite variant of the import route integration tests.
 * Skipped by default — activated by RAPITAS_TEST_SQLITE=1 (set by `bun run test:sqlite`).
 *
 * Uses createSqliteTestDb() to spin up a temp file DB, mocks config/database
 * with the SQLite PrismaClient so the import route operates on SQLite, then
 * disposes the DB in afterAll.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mock } from 'bun:test';

const SQLITE_TEST = process.env.RAPITAS_TEST_SQLITE === '1';

describe.skipIf(!SQLITE_TEST)('Import Routes (SQLite)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    // 1. Create isolated SQLite DB and populate it with DDL.
    const { createSqliteTestDb } = await import('./sqlite-test-db.ts');
    const db = await createSqliteTestDb('import');
    dispose = db.dispose;

    // 2. Register mock BEFORE importing any route that imports config/database.
    //    NOTE: Must mirror ALL exports to prevent "undefined" reference crashes
    //    (bun replaces the whole module, not individual exports).
    mock.module('../../../config/database', () => ({
      prisma: db.prisma,
      ensureDatabaseConnection: async () => {},
    }));

    // 3. Dynamically import the route AFTER the mock is in place so the route
    //    captures the SQLite PrismaClient instead of the PostgreSQL singleton.
    const { importRoutes } = await import('../../../routes/system/import.ts');
    const { Elysia } = await import('elysia');
    app = new Elysia().use(importRoutes);
  });

  afterAll(async () => {
    if (dispose) await dispose();
  });

  describe('POST /import/tasks', () => {
    test('imports tasks from JSON', async () => {
      const tasks = [
        { title: 'sqlite import task 1', status: 'todo', priority: 'high' },
        { title: 'sqlite import task 2', status: 'todo', priority: 'medium' },
      ];

      const response = await app.handle(
        new Request('http://localhost/import/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks, skipExisting: true }),
        }),
      );

      expect(response.status).toBe(200);
      const result = await response.json();

      expect(result.success).toBe(true);
      expect(result.imported.tasks).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    test('skips existing tasks when skipExisting is true', async () => {
      const title = 'sqlite skip existing task';

      // First import
      await app.handle(
        new Request('http://localhost/import/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks: [{ title }], skipExisting: true }),
        }),
      );

      // Second import — same title, should skip
      const response = await app.handle(
        new Request('http://localhost/import/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks: [{ title }], skipExisting: true }),
        }),
      );

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.skipped.tasks).toBe(1);
      expect(result.imported.tasks).toBe(0);
    });

    test('handles empty tasks array', async () => {
      const response = await app.handle(
        new Request('http://localhost/import/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks: [] }),
        }),
      );

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.imported.tasks).toBe(0);
    });

    test('imports tasks with optional fields', async () => {
      const response = await app.handle(
        new Request('http://localhost/import/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tasks: [
              {
                title: 'sqlite task with fields',
                description: 'test description',
                dueDate: '2026-12-31T23:59:59Z',
                estimatedHours: 3,
              },
            ],
          }),
        }),
      );

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.imported.tasks).toBe(1);
    });
  });

  describe('POST /import/tasks/csv', () => {
    test('imports tasks from CSV', async () => {
      const csv = `title,status,priority
sqlite csv task 1,todo,high
sqlite csv task 2,todo,medium`;

      const response = await app.handle(
        new Request('http://localhost/import/tasks/csv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv, skipExisting: true }),
        }),
      );

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.imported.tasks).toBe(2);
    });

    test('rejects CSV missing title column', async () => {
      const csv = `status,priority\ntodo,high`;

      const response = await app.handle(
        new Request('http://localhost/import/tasks/csv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv }),
        }),
      );

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toContain('title');
    });
  });

  describe('POST /import/restore', () => {
    test('restores from backup with skip mode', async () => {
      const backup = {
        version: '1.0.0',
        data: { categories: [{ name: 'sqlite test category' }] },
      };

      const response = await app.handle(
        new Request('http://localhost/import/restore?mode=skip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(backup),
        }),
      );

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.timestamp).toBeTruthy();
      expect(result.mode).toBe('skip');
    });

    test('rejects invalid backup structure', async () => {
      const response = await app.handle(
        new Request('http://localhost/import/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invalid: 'structure' }),
        }),
      );

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid');
    });
  });
});
