/**
 * Import Routes Tests
 *
 * Tests for the import API endpoints (JSON, CSV, restore)
 */

import { describe, test, expect, afterEach } from 'bun:test';
import { Elysia } from 'elysia';
import { importRoutes } from '../../../routes/system/import';
import { prisma } from '../../../config/database';

// Create test app with import routes
const app = new Elysia().use(importRoutes);

describe('Import Routes', () => {
  // Track created tasks for cleanup
  const createdTaskTitles: string[] = [];

  afterEach(async () => {
    // Clean up test tasks
    for (const title of createdTaskTitles) {
      await prisma.task.deleteMany({ where: { title } }).catch(() => {});
    }
    createdTaskTitles.length = 0;
  });

  describe('POST /import/tasks', () => {
    test('should import tasks from JSON', async () => {
      const tasks = [
        {
          title: 'Import Test Task 1',
          description: 'First imported task',
          status: 'todo',
          priority: 'high',
        },
        {
          title: 'Import Test Task 2',
          description: 'Second imported task',
          status: 'progress',
          priority: 'medium',
        },
      ];

      createdTaskTitles.push(...tasks.map((t) => t.title));

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

      // Verify tasks were created
      const createdTasks = await prisma.task.findMany({
        where: { title: { in: tasks.map((t) => t.title) } },
      });
      expect(createdTasks).toHaveLength(2);
    });

    test('should skip existing tasks when skipExisting is true', async () => {
      const title = 'Skip Existing Test Task';
      createdTaskTitles.push(title);

      // Create task first
      await prisma.task.create({
        data: { title, status: 'todo', priority: 'medium' },
      });

      // Try to import same task
      const response = await app.handle(
        new Request('http://localhost/import/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tasks: [{ title, description: 'Should be skipped' }],
            skipExisting: true,
          }),
        }),
      );

      expect(response.status).toBe(200);
      const result = await response.json();

      expect(result.skipped.tasks).toBe(1);
      expect(result.imported.tasks).toBe(0);
    });

    test('should handle empty tasks array', async () => {
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

    test('should import tasks with due dates', async () => {
      const title = 'Task With Due Date';
      createdTaskTitles.push(title);

      const response = await app.handle(
        new Request('http://localhost/import/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tasks: [
              {
                title,
                dueDate: '2026-12-31T23:59:59Z',
                estimatedHours: 5,
              },
            ],
          }),
        }),
      );

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.imported.tasks).toBe(1);

      const task = await prisma.task.findFirst({ where: { title } });
      expect(task?.dueDate).toBeTruthy();
      expect(task?.estimatedHours).toBe(5);
    });
  });

  describe('POST /import/tasks/csv', () => {
    test('should import tasks from CSV', async () => {
      const csv = `title,status,priority,description
CSV Import Task 1,todo,high,First CSV task
CSV Import Task 2,progress,medium,Second CSV task`;

      createdTaskTitles.push('CSV Import Task 1', 'CSV Import Task 2');

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

    test('should require title column', async () => {
      const csv = `status,priority
todo,high`;

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

    test('should handle quoted CSV values', async () => {
      const title = 'Task With, Comma';
      createdTaskTitles.push(title);

      const csv = `title,description
"${title}","Description with ""quotes"" and
newlines"`;

      const response = await app.handle(
        new Request('http://localhost/import/tasks/csv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv }),
        }),
      );

      expect(response.status).toBe(200);
      const result = await response.json();

      expect(result.imported.tasks).toBe(1);

      const task = await prisma.task.findFirst({ where: { title } });
      expect(task).toBeTruthy();
    });
  });

  describe('POST /import/restore', () => {
    test('should restore from backup with skip mode', async () => {
      const backup = {
        version: '1.0.0',
        data: {
          categories: [{ name: 'Restored Category' }],
        },
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
      expect(result.imported).toBeTruthy();
      expect(result.skipped).toBeTruthy();

      // Clean up
      await prisma.category.deleteMany({ where: { name: 'Restored Category' } }).catch(() => {});
    });

    test('should reject invalid backup structure', async () => {
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
