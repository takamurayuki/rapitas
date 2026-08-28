/**
 * stale-recovery-helpers unit tests
 *
 * Covers updateAffectedTasks — the todo-revert path that must also record a
 * WorkflowTransition so the self-incident watcher's recovery grace applies.
 */
import { describe, test, expect, mock } from 'bun:test';

mock.module('../../../config', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const mockRecordTransition = mock(() => Promise.resolve());
mock.module('../../workflow/transition-recorder', () => ({
  recordTransition: mockRecordTransition,
}));

const { updateAffectedTasks } = await import('./stale-recovery-helpers');
import type { OrchestratorContext } from './types';

function makeCtx(
  taskFindUnique: ReturnType<typeof mock>,
  taskUpdate: ReturnType<typeof mock> = mock(async () => ({})),
): OrchestratorContext {
  return {
    prisma: {
      task: { findUnique: taskFindUnique, update: taskUpdate },
    },
  } as unknown as OrchestratorContext;
}

describe('updateAffectedTasks', () => {
  test('reverts an in-progress task to todo and records the revert transition', async () => {
    mockRecordTransition.mockClear();
    const taskUpdate = mock(async () => ({}));
    const taskFindUnique = mock(async () => ({
      id: 100,
      status: 'in-progress',
      workflowStatus: 'in_progress',
    }));
    const ctx = makeCtx(taskFindUnique, taskUpdate);

    const updated = await updateAffectedTasks(ctx, new Set([100]));

    expect(updated).toBe(1);
    expect(taskUpdate).toHaveBeenCalledWith({ where: { id: 100 }, data: { status: 'todo' } });
    expect(mockRecordTransition).toHaveBeenCalledTimes(1);
    expect(mockRecordTransition.mock.calls[0][0]).toMatchObject({
      taskId: 100,
      fromStatus: 'in_progress',
      toStatus: 'in_progress',
      cause: 'stale_execution_recovery_revert',
    });
  });

  test('does not touch or record a transition for a task that is not in-progress', async () => {
    mockRecordTransition.mockClear();
    const taskUpdate = mock(async () => ({}));
    const taskFindUnique = mock(async () => ({
      id: 100,
      status: 'done',
      workflowStatus: 'completed',
    }));
    const ctx = makeCtx(taskFindUnique, taskUpdate);

    const updated = await updateAffectedTasks(ctx, new Set([100]));

    expect(updated).toBe(0);
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(mockRecordTransition).not.toHaveBeenCalled();
  });

  test('a task lookup failure is swallowed and does not stop remaining tasks', async () => {
    mockRecordTransition.mockClear();
    const taskFindUnique = mock(async (args: { where: { id: number } }) => {
      if (args.where.id === 1) throw new Error('lookup failed');
      return { id: 2, status: 'in-progress', workflowStatus: 'plan_approved' };
    });
    const ctx = makeCtx(taskFindUnique as unknown as ReturnType<typeof mock>);

    const updated = await updateAffectedTasks(ctx, new Set([1, 2]));

    expect(updated).toBe(1);
    expect(mockRecordTransition).toHaveBeenCalledTimes(1);
  });
});
