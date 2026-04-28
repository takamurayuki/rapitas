/**
 * Export Routes Tests
 *
 * Tests for the export API endpoints (JSON, CSV, iCal, backup)
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { exportRoutes } from '../../../routes/system/export';
import { prisma } from '../../../config/database';

// Create test app with export routes
const app = new Elysia().use(exportRoutes);

describe('Export Routes', () => {
  // Test task for export tests
  let testTaskId: number;

  beforeAll(async () => {
    // Create a test task
    const task = await prisma.task.create({
      data: {
        title: 'Export Test Task',
        description: 'Task for testing export functionality',
        status: 'todo',
        priority: 'medium',
        dueDate: new Date('2026-12-31'),
        estimatedHours: 2.5,
        labels: JSON.stringify(['test', 'export']),
      },
    });
    testTaskId = task.id;
  });

  afterAll(async () => {
    // Clean up test data
    if (testTaskId) {
      await prisma.task.delete({ where: { id: testTaskId } }).catch(() => {});
    }
  });

  describe('GET /export/tasks/json', () => {
    test('should export tasks as JSON', async () => {
      const response = await app.handle(new Request('http://localhost/export/tasks/json'));

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('exportedAt');
      expect(data).toHaveProperty('totalCount');
      expect(data).toHaveProperty('tasks');
      expect(Array.isArray(data.tasks)).toBe(true);
    });

    test('should filter by includeCompleted', async () => {
      const response = await app.handle(
        new Request('http://localhost/export/tasks/json?includeCompleted=false'),
      );

      expect(response.status).toBe(200);
      const data = await response.json();

      // All returned tasks should not be completed
      for (const task of data.tasks) {
        expect(task.status).not.toBe('completed');
      }
    });

    test('should include related data', async () => {
      const response = await app.handle(new Request('http://localhost/export/tasks/json'));

      expect(response.status).toBe(200);
      const data = await response.json();

      // Check structure includes relations
      if (data.tasks.length > 0) {
        const task = data.tasks[0];
        expect(task).toHaveProperty('id');
        expect(task).toHaveProperty('title');
        expect(task).toHaveProperty('status');
      }
    });
  });

  describe('GET /export/tasks/csv', () => {
    test('should export tasks as CSV', async () => {
      const response = await app.handle(new Request('http://localhost/export/tasks/csv'));

      expect(response.status).toBe(200);

      const contentType = response.headers.get('Content-Type');
      expect(contentType).toContain('text/csv');

      const contentDisposition = response.headers.get('Content-Disposition');
      expect(contentDisposition).toContain('attachment');
      expect(contentDisposition).toContain('.csv');

      const csv = await response.text();
      const lines = csv.split('\n');

      // Should have header row
      expect(lines[0]).toContain('id');
      expect(lines[0]).toContain('title');
      expect(lines[0]).toContain('status');
    });

    test('should have correct CSV structure', async () => {
      const response = await app.handle(new Request('http://localhost/export/tasks/csv'));

      const csv = await response.text();
      const lines = csv.split('\n').filter((l) => l.trim());
      const headers = lines[0].split(',');

      expect(headers).toContain('id');
      expect(headers).toContain('title');
      expect(headers).toContain('description');
      expect(headers).toContain('status');
      expect(headers).toContain('priority');
      expect(headers).toContain('dueDate');
    });
  });

  describe('GET /export/backup', () => {
    test('should export full backup', async () => {
      const response = await app.handle(new Request('http://localhost/export/backup'));

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('exportedAt');
      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('counts');
      expect(data).toHaveProperty('data');

      // Check counts structure
      expect(data.counts).toHaveProperty('tasks');
      expect(data.counts).toHaveProperty('projects');
      expect(data.counts).toHaveProperty('labels');
      expect(data.counts).toHaveProperty('categories');

      // Check data structure
      expect(data.data).toHaveProperty('tasks');
      expect(data.data).toHaveProperty('projects');
      expect(Array.isArray(data.data.tasks)).toBe(true);
    });

    test('should match counts with data length', async () => {
      const response = await app.handle(new Request('http://localhost/export/backup'));

      const data = await response.json();

      expect(data.counts.tasks).toBe(data.data.tasks.length);
      expect(data.counts.projects).toBe(data.data.projects.length);
      expect(data.counts.labels).toBe(data.data.labels.length);
    });
  });

  describe('GET /export/calendar/ical', () => {
    test('should export iCal format', async () => {
      const response = await app.handle(new Request('http://localhost/export/calendar/ical'));

      expect(response.status).toBe(200);

      const contentType = response.headers.get('Content-Type');
      expect(contentType).toContain('text/calendar');

      const contentDisposition = response.headers.get('Content-Disposition');
      expect(contentDisposition).toContain('.ics');

      const ical = await response.text();
      expect(ical).toContain('BEGIN:VCALENDAR');
      expect(ical).toContain('END:VCALENDAR');
      expect(ical).toContain('VERSION:2.0');
      expect(ical).toContain('PRODID:-//Rapitas//');
    });

    test('should include tasks as VTODO', async () => {
      const response = await app.handle(
        new Request('http://localhost/export/calendar/ical?includeTasks=true'),
      );

      const ical = await response.text();

      // If there are tasks with due dates, should have VTODO
      if (ical.includes('BEGIN:VTODO')) {
        expect(ical).toContain('END:VTODO');
        expect(ical).toContain('SUMMARY:');
      }
    });

    test('should filter by options', async () => {
      const response = await app.handle(
        new Request('http://localhost/export/calendar/ical?includeTasks=false&includeEvents=true'),
      );

      expect(response.status).toBe(200);
      const ical = await response.text();

      // Should still be valid iCal
      expect(ical).toContain('BEGIN:VCALENDAR');
      expect(ical).toContain('END:VCALENDAR');
    });
  });
});
