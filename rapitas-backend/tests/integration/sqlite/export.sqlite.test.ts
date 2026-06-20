/**
 * export.sqlite.test.ts
 *
 * SQLite variant of the export route integration tests.
 * Skipped by default — activated by RAPITAS_TEST_SQLITE=1 (set by `bun run test:sqlite`).
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mock } from 'bun:test';

const SQLITE_TEST = process.env.RAPITAS_TEST_SQLITE === '1';

describe.skipIf(!SQLITE_TEST)('Export Routes (SQLite)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    const { createSqliteTestDb } = await import('./sqlite-test-db.ts');
    const db = await createSqliteTestDb('export');
    dispose = db.dispose;

    // Create a test task so export endpoints have data to return.
    await db.prisma.task.create({
      data: {
        title: 'export test task',
        description: 'used by sqlite export tests',
        status: 'todo',
        priority: 'medium',
        dueDate: new Date('2026-12-31'),
        estimatedHours: 2,
        labels: JSON.stringify(['test']),
      },
    });

    mock.module('../../../config/database', () => ({
      prisma: db.prisma,
      ensureDatabaseConnection: async () => {},
    }));

    const { exportRoutes } = await import('../../../routes/system/export.ts');
    const { Elysia } = await import('elysia');
    app = new Elysia().use(exportRoutes);
  });

  afterAll(async () => {
    if (dispose) await dispose();
  });

  describe('GET /export/tasks/json', () => {
    test('exports tasks as JSON', async () => {
      const response = await app.handle(new Request('http://localhost/export/tasks/json'));

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('exportedAt');
      expect(data).toHaveProperty('totalCount');
      expect(data).toHaveProperty('tasks');
      expect(Array.isArray(data.tasks)).toBe(true);
      expect(data.totalCount).toBeGreaterThan(0);
    });

    test('filters out completed tasks when includeCompleted=false', async () => {
      const response = await app.handle(
        new Request('http://localhost/export/tasks/json?includeCompleted=false'),
      );

      expect(response.status).toBe(200);
      const data = await response.json();

      for (const task of data.tasks) {
        expect(task.status).not.toBe('completed');
      }
    });

    test('exported task has expected fields', async () => {
      const response = await app.handle(new Request('http://localhost/export/tasks/json'));
      const data = await response.json();

      const task = data.tasks.find((t: { title: string }) => t.title === 'export test task');
      expect(task).toBeTruthy();
      expect(task).toHaveProperty('id');
      expect(task).toHaveProperty('title');
      expect(task).toHaveProperty('status');
    });
  });

  describe('GET /export/tasks/csv', () => {
    test('exports tasks as CSV with correct Content-Type', async () => {
      const response = await app.handle(new Request('http://localhost/export/tasks/csv'));

      expect(response.status).toBe(200);
      const contentType = response.headers.get('Content-Type');
      expect(contentType).toContain('text/csv');

      const contentDisposition = response.headers.get('Content-Disposition');
      expect(contentDisposition).toContain('attachment');
      expect(contentDisposition).toContain('.csv');
    });

    test('CSV has expected header columns', async () => {
      const response = await app.handle(new Request('http://localhost/export/tasks/csv'));
      const csv = await response.text();
      const headers = csv.split('\n')[0].split(',');

      expect(headers).toContain('id');
      expect(headers).toContain('title');
      expect(headers).toContain('status');
      expect(headers).toContain('priority');
    });
  });

  describe('GET /export/backup', () => {
    test('exports full backup structure', async () => {
      const response = await app.handle(new Request('http://localhost/export/backup'));

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('exportedAt');
      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('counts');
      expect(data).toHaveProperty('data');
      expect(data.counts).toHaveProperty('tasks');
      expect(Array.isArray(data.data.tasks)).toBe(true);
    });

    test('counts match data lengths', async () => {
      const response = await app.handle(new Request('http://localhost/export/backup'));
      const data = await response.json();

      expect(data.counts.tasks).toBe(data.data.tasks.length);
    });
  });

  describe('GET /export/calendar/ical', () => {
    test('exports valid iCal format', async () => {
      const response = await app.handle(new Request('http://localhost/export/calendar/ical'));

      expect(response.status).toBe(200);
      const contentType = response.headers.get('Content-Type');
      expect(contentType).toContain('text/calendar');

      const ical = await response.text();
      expect(ical).toContain('BEGIN:VCALENDAR');
      expect(ical).toContain('END:VCALENDAR');
      expect(ical).toContain('VERSION:2.0');
    });
  });
});
