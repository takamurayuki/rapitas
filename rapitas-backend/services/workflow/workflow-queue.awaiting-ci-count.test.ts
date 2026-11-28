/**
 * workflow-queue.awaiting-ci-count.test
 *
 * A queue item handed back for a CI wait is stored as `completed` + `awaiting_ci`
 * (task 1568), but the task has not finished: it must not count as completed
 * (task 1570).
 */
import { describe, test, expect, mock } from 'bun:test';

const findMany = mock(async (_args: unknown): Promise<unknown[]> => []);
const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, fatal() {} };

mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('../../config', () => ({
  prisma: { workflowQueueItem: { findMany } },
  createLogger: () => noopLogger,
  logger: noopLogger,
  ensureDatabaseConnection: () => Promise.resolve(),
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => 'default',
  getProjectRoot: () => '/tmp/rapitas-test',
}));
mock.module('../task/task-resolver', () => ({
  resolveTaskWorkflowState: async () => null,
  taskRowConfirmedAbsent: async () => false,
}));

const { WorkflowQueueService } = await import('./workflow-queue');

function row(id: number, status: string, currentPhase: string) {
  return {
    id,
    taskId: id * 10,
    orchestraSessionId: null,
    priority: 50,
    status,
    currentPhase,
    dependencies: '[]',
    retryCount: 0,
    maxRetries: 3,
    errorMessage: null,
    queuedAt: new Date('2026-01-01T00:00:00Z'),
    startedAt: null,
    completedAt: null,
  };
}

describe('WorkflowQueueService.getQueueState — CI wait', () => {
  test('leaves a handed-back CI-wait item out of completed, keeping totalItems', async () => {
    findMany.mockResolvedValueOnce([
      row(1, 'completed', 'verify_done'),
      row(2, 'completed', 'awaiting_ci'),
    ]);

    const state = await new WorkflowQueueService().getQueueState();

    expect(state.completed.map((i) => i.id)).toEqual([1]);
    expect(state.totalItems).toBe(2);
  });

  test('reports nothing completed when the only completed item waits for CI', async () => {
    findMany.mockResolvedValueOnce([row(2, 'completed', 'awaiting_ci')]);

    const state = await new WorkflowQueueService().getQueueState();

    expect(state.completed).toEqual([]);
    expect(state.totalItems).toBe(1);
  });
});
