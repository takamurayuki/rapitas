/**
 * workflow-queue テスト（getQueueState / getSessionItems / recoverStaleItems / findByTaskId）
 *
 * enqueue/concurrency設定は workflow-queue.test.ts、updateStatus 等は
 * workflow-queue.status.test.ts、dequeue() は workflow-queue.dequeue.test.ts に
 * 分割する（ファイルサイズ制限のため）。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// HACK(agent): bun:test の mock.module はプロセスグローバルなため、
// 全エクスポートをミラーしないとバレルが "export not found" をスローする。

type MockFn = ReturnType<typeof mock>;

const noopLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  fatal: mock(() => {}),
};

mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

interface WorkflowQueueItemRow {
  id: number;
  taskId: number;
  orchestraSessionId: number | null;
  priority: number;
  status: string;
  currentPhase: string;
  dependencies: string;
  retryCount: number;
  maxRetries: number;
  errorMessage: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface FakePrisma {
  workflowQueueItem: {
    findFirst: MockFn;
    findMany: MockFn;
    create: MockFn;
    count: MockFn;
    update: MockFn;
    updateMany: MockFn;
    findUnique: MockFn;
  };
  task: {
    findMany: MockFn;
  };
  $transaction: MockFn;
}

function makePrisma(): FakePrisma {
  const p: FakePrisma = {
    workflowQueueItem: {
      findFirst: mock(() => Promise.resolve(null)),
      findMany: mock(() => Promise.resolve([])),
      create: mock(() => Promise.resolve(null)),
      count: mock(() => Promise.resolve(0)),
      update: mock(() => Promise.resolve(null)),
      updateMany: mock(() => Promise.resolve({ count: 0 })),
      findUnique: mock(() => Promise.resolve(null)),
    },
    task: {
      findMany: mock(() => Promise.resolve([])),
    },
    $transaction: mock((cb: (tx: FakePrisma) => unknown) => cb(p)),
  };
  return p;
}

const prismaMock = makePrisma();

mock.module('../../config', () => ({
  prisma: prismaMock,
  createLogger: () => noopLogger,
  logger: noopLogger,
  ensureDatabaseConnection: () => Promise.resolve(),
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => 'default',
  getProjectRoot: () => '/tmp/rapitas-test',
}));

interface TaskWorkflowStateRow {
  id: number;
  status: string;
  workflowStatus: string;
  workflowMode: string;
  parentId: number | null;
}

const resolveTaskWorkflowStateMock = mock((_taskId: number) =>
  Promise.resolve<TaskWorkflowStateRow | null>(null),
);

mock.module('../task/task-resolver', () => ({
  resolveTaskWorkflowState: resolveTaskWorkflowStateMock,
  resolveTaskWithTheme: mock(() => Promise.resolve(null)),
  resolveTaskWithThemeAndCategory: mock(() => Promise.resolve(null)),
  resolveTaskForExecution: mock(() => Promise.resolve(null)),
  resolveTaskWorkingDirectory: mock(() => Promise.resolve(null)),
  resolveTaskTitle: mock(() => Promise.resolve(null)),
  resolveTaskThemeId: mock(() => Promise.resolve(null)),
  resolveTaskForComplexityAnalysis: mock(() => Promise.resolve(null)),
  resolveTaskSubtaskInfo: mock(() => Promise.resolve(null)),
  resolveTaskForPlanApproval: mock(() => Promise.resolve(null)),
  resolveTaskForAutoMerge: mock(() => Promise.resolve(null)),
  resolveTaskForLearning: mock(() => Promise.resolve(null)),
  taskRowConfirmedAbsent: mock(() => Promise.resolve(false)),
}));

const { WorkflowQueueService } = await import('./workflow-queue');

function resetPrisma(): void {
  prismaMock.workflowQueueItem.findFirst.mockReset().mockResolvedValue(null);
  prismaMock.workflowQueueItem.findMany.mockReset().mockResolvedValue([]);
  prismaMock.workflowQueueItem.create.mockReset().mockResolvedValue(null);
  prismaMock.workflowQueueItem.count.mockReset().mockResolvedValue(0);
  prismaMock.workflowQueueItem.update.mockReset().mockResolvedValue(null);
  prismaMock.workflowQueueItem.updateMany.mockReset().mockResolvedValue({ count: 0 });
  prismaMock.workflowQueueItem.findUnique.mockReset().mockResolvedValue(null);
  prismaMock.task.findMany.mockReset().mockResolvedValue([]);
  prismaMock.$transaction
    .mockReset()
    .mockImplementation((cb: (tx: FakePrisma) => unknown) => cb(prismaMock));
}

function row(overrides: Partial<WorkflowQueueItemRow> = {}): WorkflowQueueItemRow {
  return {
    id: 1,
    taskId: 10,
    orchestraSessionId: null,
    priority: 50,
    status: 'queued',
    currentPhase: 'draft',
    dependencies: '[]',
    retryCount: 0,
    maxRetries: 3,
    errorMessage: null,
    queuedAt: new Date('2026-01-01T00:00:00Z'),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetPrisma();
  resolveTaskWorkflowStateMock.mockReset().mockResolvedValue(null);
  noopLogger.info.mockClear();
  noopLogger.warn.mockClear();
  noopLogger.error.mockClear();
});

describe('WorkflowQueueService.getQueueState', () => {
  test('status ごとにグルーピングし totalItems / maxConcurrency を返すこと', async () => {
    const svc = new WorkflowQueueService();
    svc.setMaxConcurrency(7);
    prismaMock.workflowQueueItem.findMany.mockResolvedValueOnce([
      row({ id: 1, status: 'queued' }),
      row({ id: 2, status: 'running' }),
      row({ id: 3, status: 'waiting_approval' }),
      row({ id: 4, status: 'completed' }),
      row({ id: 5, status: 'failed' }),
      row({ id: 6, status: 'queued' }),
    ]);

    const state = await svc.getQueueState();

    expect(state.queued.map((i) => i.id)).toEqual([1, 6]);
    expect(state.running.map((i) => i.id)).toEqual([2]);
    expect(state.waitingApproval.map((i) => i.id)).toEqual([3]);
    expect(state.completed.map((i) => i.id)).toEqual([4]);
    expect(state.failed.map((i) => i.id)).toEqual([5]);
    expect(state.totalItems).toBe(6);
    expect(state.maxConcurrency).toBe(7);
    expect(prismaMock.workflowQueueItem.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ priority: 'desc' }, { queuedAt: 'asc' }],
    });
  });

  test('sessionId 指定時は where に orchestraSessionId を含めること', async () => {
    const svc = new WorkflowQueueService();
    await svc.getQueueState(9);

    expect(prismaMock.workflowQueueItem.findMany).toHaveBeenCalledWith({
      where: { orchestraSessionId: 9 },
      orderBy: [{ priority: 'desc' }, { queuedAt: 'asc' }],
    });
  });
});

describe('WorkflowQueueService.getSessionItems', () => {
  test('指定セッションのアイテムのみをマップして返すこと', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.findMany.mockResolvedValueOnce([
      row({ id: 1, orchestraSessionId: 9, dependencies: '[3,4]' }),
    ]);

    const items = await svc.getSessionItems(9);

    expect(prismaMock.workflowQueueItem.findMany).toHaveBeenCalledWith({
      where: { orchestraSessionId: 9 },
      orderBy: [{ priority: 'desc' }, { queuedAt: 'asc' }],
    });
    expect(items).toEqual([expect.objectContaining({ id: 1, dependencies: [3, 4] })]);
  });
});

describe('WorkflowQueueService.recoverStaleItems', () => {
  test('running のアイテムを queued に戻し件数を返すこと', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.updateMany.mockResolvedValueOnce({ count: 3 });

    const count = await svc.recoverStaleItems();

    expect(prismaMock.workflowQueueItem.updateMany).toHaveBeenCalledWith({
      where: { status: 'running' },
      data: { status: 'queued', startedAt: null },
    });
    expect(count).toBe(3);
  });

  test('件数が 0 の場合 → ログを出さないこと', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.updateMany.mockResolvedValueOnce({ count: 0 });

    const count = await svc.recoverStaleItems();

    expect(count).toBe(0);
    expect(noopLogger.info).not.toHaveBeenCalled();
  });
});

describe('WorkflowQueueService.findByTaskId', () => {
  test('sessionId 未指定 → orchestraSessionId を where に含めないこと', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.findFirst.mockResolvedValueOnce(row({ taskId: 10 }));

    const result = await svc.findByTaskId(10);

    expect(prismaMock.workflowQueueItem.findFirst).toHaveBeenCalledWith({
      where: { taskId: 10, status: { in: ['queued', 'running', 'waiting_approval'] } },
    });
    expect(result?.taskId).toBe(10);
  });

  test('sessionId 指定 → where に含めること', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.findFirst.mockResolvedValueOnce(null);

    const result = await svc.findByTaskId(10, 3);

    expect(prismaMock.workflowQueueItem.findFirst).toHaveBeenCalledWith({
      where: {
        taskId: 10,
        orchestraSessionId: 3,
        status: { in: ['queued', 'running', 'waiting_approval'] },
      },
    });
    expect(result).toBeNull();
  });
});
