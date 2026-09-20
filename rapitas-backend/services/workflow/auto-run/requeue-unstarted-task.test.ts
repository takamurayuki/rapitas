/**
 * requeue-unstarted-task.test
 *
 * Run alone: bun's mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockEnqueue = mock((_arg: unknown) => Promise.resolve({}));
const mockRecordTransition = mock((_arg: unknown) => Promise.resolve());
mock.module('../workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => ({ enqueue: mockEnqueue }) },
}));
mock.module('../transition-recorder', () => ({ recordTransition: mockRecordTransition }));

const { requeueUnstartedTask, MAX_UNSTARTED_REQUEUES } = await import('./requeue-unstarted-task');

const update = mock((_arg: unknown) => Promise.resolve({}));
let row: { status: string; workflowStatus: string | null; haltReason: string | null } | null;
let prior = 0;
const prisma = {
  task: { findUnique: () => Promise.resolve(row), update },
  workflowTransition: { count: () => Promise.resolve(prior) },
} as never;

beforeEach(() => {
  mockEnqueue.mockClear().mockResolvedValue({});
  mockRecordTransition.mockClear();
  update.mockClear();
  row = { status: 'todo', workflowStatus: null, haltReason: null };
  prior = 0;
});

describe('requeueUnstartedTask', () => {
  test('未実行タスクを todo に戻し enqueue と transition を記録する', async () => {
    expect(await requeueUnstartedTask(prisma, 984, 1)).toBe(true);
    expect(update).toHaveBeenCalledWith({ where: { id: 984 }, data: { status: 'todo' } });
    expect(mockEnqueue).toHaveBeenCalledWith({ taskId: 984, themeId: 1, priority: 50 });
    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 984,
        actor: 'system',
        cause: 'backstop_unstarted_requeue',
      }),
    );
  });

  test('haltReason 付きは復帰しない（K-10720）', async () => {
    row = { status: 'todo', workflowStatus: null, haltReason: 'repeat_cause_detected' };
    expect(await requeueUnstartedTask(prisma, 984, 1)).toBe(false);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  test('上限到達後は false（blocked へフォールバック）', async () => {
    prior = MAX_UNSTARTED_REQUEUES;
    expect(await requeueUnstartedTask(prisma, 984, 1)).toBe(false);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  test('既に queue にある場合は成功扱い、enqueue 失敗は false', async () => {
    mockEnqueue.mockRejectedValueOnce(new Error('Task 984 is already in the queue'));
    expect(await requeueUnstartedTask(prisma, 984, 1)).toBe(true);
    mockEnqueue.mockRejectedValueOnce(new Error('boom'));
    expect(await requeueUnstartedTask(prisma, 984, 1)).toBe(false);
  });
});
