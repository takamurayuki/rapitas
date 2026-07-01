/**
 * workflow-reconciler-requeue テスト
 *
 * healUndispatchableTodo: todo×verify_done（遷移表に無い死に状態）を draft へ
 * リセット（1回限り）、todo×completed を done へ確定。live実行中はスキップ。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  task: {
    findMany: mock(() => Promise.resolve([] as unknown[])),
    update: mock(() => Promise.resolve({})),
  },
  agentExecution: { findFirst: mock(() => Promise.resolve(null as unknown)) },
  workflowTransition: { count: mock(() => Promise.resolve(0)) },
  themeAutoRun: { findMany: mock(() => Promise.resolve([] as unknown[])) },
  userSettings: { findFirst: mock(() => Promise.resolve(null as unknown)) },
  activityLog: { findFirst: mock(() => Promise.resolve(null as unknown)) },
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
mock.module('../../services/workflow/transition-recorder', () => ({ recordTransition }));

const { healUndispatchableTodo } =
  await import('../../services/workflow/workflow-reconciler-requeue');

const NOW = 1_800_000_000_000;

describe('healUndispatchableTodo', () => {
  beforeEach(() => {
    mockPrisma.task.findMany.mockReset().mockResolvedValue([]);
    mockPrisma.task.update.mockReset().mockResolvedValue({});
    mockPrisma.agentExecution.findFirst.mockReset().mockResolvedValue(null);
    mockPrisma.workflowTransition.count.mockReset().mockResolvedValue(0);
    recordTransition.mockReset().mockResolvedValue(undefined);
  });

  test('todo×verify_done を draft へリセットし遷移を記録すること', async () => {
    // 1st findMany = stranded (verify_done), 2nd = completed desync
    mockPrisma.task.findMany.mockResolvedValueOnce([{ id: 8 }]).mockResolvedValueOnce([]);

    const healed = await healUndispatchableTodo(NOW);

    expect(healed).toBe(1);
    const tu = mockPrisma.task.update.mock.calls[0][0] as {
      data: { workflowStatus: string };
    };
    expect(tu.data.workflowStatus).toBe('draft');
    const rt = recordTransition.mock.calls[0][0] as { cause: string; fromStatus: string };
    expect(rt.cause).toBe('reconciler_reset_undispatchable');
    expect(rt.fromStatus).toBe('verify_done');
  });

  test('リセットは1タスク1回限り（2回目はスキップ）', async () => {
    mockPrisma.task.findMany.mockResolvedValueOnce([{ id: 8 }]).mockResolvedValueOnce([]);
    mockPrisma.workflowTransition.count.mockResolvedValue(1); // already reset once

    const healed = await healUndispatchableTodo(NOW);

    expect(healed).toBe(0);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  test('live実行が居るタスクはスキップ（実行中の完了処理と競合しない）', async () => {
    mockPrisma.task.findMany.mockResolvedValueOnce([{ id: 8 }]).mockResolvedValueOnce([]);
    mockPrisma.agentExecution.findFirst.mockResolvedValue({ id: 1 });

    const healed = await healUndispatchableTodo(NOW);

    expect(healed).toBe(0);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  test('todo×completed は done へ確定すること', async () => {
    mockPrisma.task.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 12, completedAt: null }]);

    const healed = await healUndispatchableTodo(NOW);

    expect(healed).toBe(1);
    const tu = mockPrisma.task.update.mock.calls[0][0] as {
      data: { status: string; completedAt: Date };
    };
    expect(tu.data.status).toBe('done');
    expect(tu.data.completedAt).toBeInstanceOf(Date);
  });
});
