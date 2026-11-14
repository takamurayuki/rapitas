// @ts-nocheck — Loosely-typed mock setup; types are not the concern of this test file.
/**
 * task-create-spec-fields.test
 *
 * POST /tasks declares its body with t.Object, and Elysia drops what the
 * schema does not name. `userAcceptanceChecks` (what only the person can
 * check) was missing from it, so a task created with them kept none, though
 * createTask stores them (found in the #1545 trial, fixed in #1547).
 */
import { describe, it, expect, mock } from 'bun:test';

const createTask = mock(async (_db, data) => ({ id: 1, ...data }));

mock.module('../../config/database', () => ({ prisma: {} }));
mock.module('../../config', () => ({
  prisma: {},
  getProjectRoot: () => '/tmp/rapitas-test',
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));
mock.module('../../services/task/task-service', () => ({
  createTask,
  updateTask: mock(async () => ({})),
  cleanupDuplicateSubtasks: mock(async () => ({})),
  cleanupAllDuplicateSubtasks: mock(async () => ({})),
  attachBlockedCauses: mock(async (x) => x),
  attachAutoRunCardStatus: mock(async (x) => x),
}));

const { tasksRoutes } = await import('./tasks');

describe('POST /tasks', () => {
  it('keeps the checks only the person can make', async () => {
    const res = await tasksRoutes.handle(
      new Request('http://localhost/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'ログに理由を残す',
          acceptanceCriteria: ['dev-pull.test.cjs が通る'],
          userAcceptanceChecks: ['次の起動後、ログに理由が出ている'],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(createTask.mock.calls.at(-1)[1].userAcceptanceChecks).toEqual([
      '次の起動後、ログに理由が出ている',
    ]);
  });
});
