/**
 * workflow-handlers-file-read.test
 *
 * `PUT /tasks/:taskId/files/:fileType` existed with no GET counterpart, so an
 * agent checking for its own artifact at the mirrored URL got a 404 from the
 * router and read it as "the artifact does not exist".
 *
 * Measured cost on 2026-10-09: task 1168's research row was written at
 * 07:33:21, yet every verify round from 08:06 on recorded
 * «`GET /workflow/tasks/1168/files/research` が HTTP 404（Resource not found）»
 * as an unmet acceptance criterion — three verify_repair bounces and an
 * `iteration_budget_halted`, plus a follow-up task (1170) filed on that false
 * premise. The artifact was there the whole time.
 *
 * So the case that matters most here is the middle one: a task that exists with
 * no artifact of that type must answer 200 with `exists: false`, never 404 —
 * otherwise the route reproduces the exact ambiguity it is meant to remove.
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { NotFoundError, ValidationError } from '../../../middleware/error-handler';

const mockTaskFindUnique = mock((_args?: unknown) => Promise.resolve<unknown>(null));
const mockWorkflowFileFindUnique = mock((_args?: unknown) => Promise.resolve<unknown>(null));

const mockPrisma = {
  task: { findUnique: (args: unknown) => mockTaskFindUnique(args) },
  workflowFile: { findUnique: (args: unknown) => mockWorkflowFileFindUnique(args) },
};
// NOTE: config/index.ts re-exports createLogger, and a mock that omits an
// export a module under test imports makes the whole file stop silently —
// mirror every export the import graph actually reaches.
const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
  logger: noopLogger,
  createLogger: () => noopLogger,
  getDbProvider: () => 'sqlite',
  getInsensitiveMode: () => undefined,
  getProjectRoot: () => 'C:/Projects/rapitas',
}));
mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { handleGetFile } = await import('./workflow-handlers-file-read');

const TASK = { id: 1168, themeId: 1, workflowStatus: 'plan_approved', theme: { categoryId: 1 } };

const call = (taskId: string, fileType: string) =>
  handleGetFile({ params: { taskId, fileType }, set: { status: 200 } });

describe('handleGetFile — GET /tasks/:taskId/files/:fileType', () => {
  beforeEach(() => {
    mockTaskFindUnique.mockReset();
    mockWorkflowFileFindUnique.mockReset();
    mockTaskFindUnique.mockImplementation(() => Promise.resolve(TASK));
    mockWorkflowFileFindUnique.mockImplementation(() => Promise.resolve(null));
  });

  test('returns the artifact when the row exists', async () => {
    mockWorkflowFileFindUnique.mockImplementation(() =>
      Promise.resolve({
        content: '# タスク調査レポート',
        sizeBytes: 5754,
        updatedAt: new Date('2026-10-09T07:33:21.000Z'),
      }),
    );

    const res = await call('1168', 'research');

    expect(res.type).toBe('research');
    expect(res.exists).toBe(true);
    expect(res.content).toBe('# タスク調査レポート');
    expect(res.size).toBe(5754);
    expect(res.lastModified).toBe('2026-10-09T07:33:21.000Z');
  });

  test('answers 200 with exists:false — not 404 — when the task has no such artifact', async () => {
    // The whole point: "no artifact" must be distinguishable from "no route".
    const set = { status: 200 };
    const res = await handleGetFile({ params: { taskId: '1168', fileType: 'verify' }, set });

    expect(res).toEqual({ type: 'verify', exists: false });
    expect(set.status).toBe(200);
  });

  test('reads each of the four workflow file types', async () => {
    for (const fileType of ['research', 'question', 'plan', 'verify']) {
      const res = await call('1168', fileType);
      expect(res.type).toBe(fileType);
    }
  });

  test('rejects an unknown file type', async () => {
    expect(call('1168', 'design')).rejects.toBeInstanceOf(ValidationError);
  });

  test('rejects a non-numeric task id', async () => {
    expect(call('abc', 'research')).rejects.toBeInstanceOf(ValidationError);
  });

  test('404s when the task itself does not exist', async () => {
    mockTaskFindUnique.mockImplementation(() => Promise.resolve(null));
    expect(call('999999', 'research')).rejects.toBeInstanceOf(NotFoundError);
  });

  test('validates the file type before touching the database', async () => {
    // An invalid type must not cost a task lookup.
    await call('1168', 'nope').catch(() => {});
    expect(mockTaskFindUnique).not.toHaveBeenCalled();
  });
});
