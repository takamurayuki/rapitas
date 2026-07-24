/**
 * workflow-handlers-mode.test
 *
 * Tests for handleSetWorkflowDisabled: the per-task "workflow disabled" toggle
 * must accept only a boolean body, refuse to flip once the task has left
 * 'todo' (server-side lock, not just a hidden UI control), and otherwise
 * persist the flag + an activity-log entry.
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

const mockResolveTaskWorkflowState = mock(() =>
  Promise.resolve<{ id: number; status: string; workflowStatus: string | null } | null>(null),
);
mock.module('../../../services/task/task-resolver', () => ({
  resolveTaskWorkflowState: mockResolveTaskWorkflowState,
  resolveTaskForComplexityAnalysis: mock(() => Promise.resolve(null)),
}));

const mockUpdate = mock(() => Promise.resolve({ id: 1, workflowDisabled: true }));
const mockActivityLogCreate = mock(() => Promise.resolve({}));
const mockPrisma = {
  task: { update: mockUpdate },
  activityLog: { create: mockActivityLogCreate },
};
mock.module('../../../config', () => ({ prisma: mockPrisma }));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

class ValidationError extends Error {
  statusCode = 400;
  constructor(msg: string) {
    super(msg);
    this.name = 'ValidationError';
  }
}
class NotFoundError extends Error {
  statusCode = 404;
  constructor(msg: string) {
    super(msg);
    this.name = 'NotFoundError';
  }
}
class ConflictError extends Error {
  statusCode = 409;
  constructor(msg: string) {
    super(msg);
    this.name = 'ConflictError';
  }
}
mock.module('../../../middleware/error-handler', () => ({
  parseId: (v: string) => Number(v),
  ValidationError,
  NotFoundError,
  ConflictError,
}));

// Handlers unrelated to this test still get imported transitively by
// workflow-handlers-mode.ts — stub their dependencies so the module loads.
mock.module('../../../services/workflow/workflow-types', () => ({ WORKFLOW_MODES: [] }));
mock.module('../../../services/workflow/workflow-types.guards.generated', () => ({
  isWorkflowMode: () => true,
}));
mock.module('../../../services/workflow/complexity-analyzer', () => ({
  analyzeTaskComplexityWithLearning: mock(() => Promise.resolve({})),
  getWorkflowModeConfig: () => ({}),
}));
mock.module('../../../utils/common', () => ({ parseSpecArray: () => [] }));

import { handleSetWorkflowDisabled } from './workflow-handlers-mode';

const makeSet = () => ({ status: 200 as number });

beforeEach(() => {
  mockResolveTaskWorkflowState.mockReset();
  mockUpdate.mockReset();
  mockActivityLogCreate.mockReset();
});

describe('handleSetWorkflowDisabled', () => {
  test('rejects a non-boolean disabled value', async () => {
    await expect(
      handleSetWorkflowDisabled({
        params: { taskId: '1' },
        body: { disabled: 'yes' },
        set: makeSet(),
      }),
    ).rejects.toThrow(ValidationError);
    expect(mockResolveTaskWorkflowState).not.toHaveBeenCalled();
  });

  test('throws NotFoundError when the task does not exist', async () => {
    mockResolveTaskWorkflowState.mockResolvedValueOnce(null);

    await expect(
      handleSetWorkflowDisabled({
        params: { taskId: '1' },
        body: { disabled: true },
        set: makeSet(),
      }),
    ).rejects.toThrow(NotFoundError);
  });

  test('refuses to change once the task has left todo status', async () => {
    mockResolveTaskWorkflowState.mockResolvedValueOnce({
      id: 1,
      status: 'in-progress',
      workflowStatus: 'in_progress',
    });

    await expect(
      handleSetWorkflowDisabled({
        params: { taskId: '1' },
        body: { disabled: true },
        set: makeSet(),
      }),
    ).rejects.toThrow(ConflictError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('persists the flag and records an activity-log entry for a todo task', async () => {
    mockResolveTaskWorkflowState.mockResolvedValueOnce({
      id: 1,
      status: 'todo',
      workflowStatus: 'draft',
    });

    const result = await handleSetWorkflowDisabled({
      params: { taskId: '1' },
      body: { disabled: true },
      set: makeSet(),
    });

    expect(result).toMatchObject({ success: true, taskId: 1, workflowDisabled: true });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ workflowDisabled: true }),
      }),
    );
    expect(mockActivityLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ taskId: 1, action: 'workflow_disabled_changed' }),
      }),
    );
  });
});
