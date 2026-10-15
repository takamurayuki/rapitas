/**
 * workflow-reconciler-requeue — requeueOrphanTasks の回収上限到達時の遷移 (task 977)
 *
 * MAX_ORPHAN_REQUEUE(2回)到達後、従来は無条件で continue し状態変化が無いため
 * status='in-progress' のまま永久残留していた（自己検出インシデントが無限再発する
 * 根本原因）。上限到達時は status='blocked' へ遷移し、既存のblockedタスク
 * 再試行/エスカレーション経路に合流させることを検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  task: {
    findMany: mock(() => Promise.resolve([] as unknown[])),
    update: mock(() => Promise.resolve({})),
  },
  agentExecution: { findFirst: mock(() => Promise.resolve(null as unknown)) },
  workflowQueueItem: { findFirst: mock(async (): Promise<{ id: number } | null> => null) },
  workflowTransition: { count: mock(() => Promise.resolve(0)) },
};
const recordTransition = mock(() => Promise.resolve());

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('./transition-recorder', () => ({ recordTransition }));
mock.module('./verify-settle-artifact-recovery', () => ({
  isAwaitingRequiredMerge: () => Promise.resolve(false),
}));

const { requeueOrphanTasks } = await import('./workflow-reconciler-requeue');

const NOW = 1_800_000_000_000;

beforeEach(() => {
  mockPrisma.task.findMany.mockReset().mockResolvedValue([]);
  mockPrisma.task.update.mockReset().mockResolvedValue({});
  mockPrisma.agentExecution.findFirst.mockReset().mockResolvedValue(null);
  mockPrisma.workflowTransition.count.mockReset().mockResolvedValue(0);
  recordTransition.mockReset().mockResolvedValue(undefined);
  mockPrisma.workflowQueueItem.findFirst.mockReset().mockResolvedValue(null);
});

describe('requeueOrphanTasks — 回収上限到達後のblocked遷移', () => {
  test('再キュー試行が上限(2回)到達済みのタスクは blocked へ遷移する', async () => {
    mockPrisma.task.findMany.mockResolvedValueOnce([
      { id: 968, title: '停滞タスク', workflowStatus: 'research_done' },
    ]);
    mockPrisma.workflowTransition.count.mockResolvedValueOnce(2);

    const requeued = await requeueOrphanTasks(NOW);

    expect(requeued).toBe(0);
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: 968 },
      data: expect.objectContaining({ status: 'blocked' }),
    });
    // workflowStatus はこの遷移で書き換えない — blocked_auto_retry が改めて
    // draft へリセットする既存挙動をそのまま活かすため。
    const updateArgs = mockPrisma.task.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(updateArgs.data).not.toHaveProperty('workflowStatus');
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 968,
        cause: 'orphan_requeue_exhausted',
      }),
    );
  });

  test('再キュー試行が1回(上限未到達)のタスクは従来どおり todo へ戻す', async () => {
    mockPrisma.task.findMany.mockResolvedValueOnce([
      { id: 969, title: '再試行1回目', workflowStatus: 'research_done' },
    ]);
    mockPrisma.workflowTransition.count.mockResolvedValueOnce(1);

    const requeued = await requeueOrphanTasks(NOW);

    expect(requeued).toBe(1);
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: 969 },
      data: expect.objectContaining({ status: 'todo' }),
    });
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 969, cause: 'reconciler_requeue' }),
    );
  });

  test('除外条件(hasLiveExecution)に該当するタスクは上限到達判定に到達しない', async () => {
    mockPrisma.task.findMany.mockResolvedValueOnce([
      { id: 970, title: 'live実行あり', workflowStatus: 'research_done' },
    ]);
    mockPrisma.agentExecution.findFirst.mockResolvedValueOnce({ id: 1 });

    const requeued = await requeueOrphanTasks(NOW);

    expect(requeued).toBe(0);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
    expect(mockPrisma.workflowTransition.count).not.toHaveBeenCalled();
  });

  test('除外条件(アクティブキュー)に該当するタスクは上限到達判定に到達しない', async () => {
    mockPrisma.task.findMany.mockResolvedValueOnce([
      { id: 971, title: 'キュー中', workflowStatus: 'research_done' },
    ]);
    mockPrisma.workflowQueueItem.findFirst.mockResolvedValueOnce({ id: 5 });

    const requeued = await requeueOrphanTasks(NOW);

    expect(requeued).toBe(0);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
    expect(mockPrisma.workflowTransition.count).not.toHaveBeenCalled();
  });

  test('除外条件(awaiting_question)に該当するタスクは上限到達判定に到達しない', async () => {
    mockPrisma.task.findMany.mockResolvedValueOnce([
      { id: 972, title: '質問待ち', workflowStatus: 'awaiting_question' },
    ]);

    const requeued = await requeueOrphanTasks(NOW);

    expect(requeued).toBe(0);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
    expect(mockPrisma.workflowTransition.count).not.toHaveBeenCalled();
  });
});
