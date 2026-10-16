/**
 * workflow-queue テスト（concurrency設定 / enqueue）
 *
 * updateStatus/retryIfPossible/cancel/updatePriority は workflow-queue.status.test.ts、
 * getQueueState/getSessionItems/recoverStaleItems/findByTaskId は
 * workflow-queue.query.test.ts、dequeue() は workflow-queue.dequeue.test.ts に
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

describe('WorkflowQueueService — concurrency config', () => {
  test('getInstance() は同一インスタンスを返すこと', () => {
    const a = WorkflowQueueService.getInstance();
    const b = WorkflowQueueService.getInstance();
    expect(a).toBe(b);
  });

  test('setMaxConcurrency は 1〜10 の範囲にクランプすること', () => {
    const svc = new WorkflowQueueService();
    svc.setMaxConcurrency(0);
    expect(svc.getMaxConcurrency()).toBe(1);
    svc.setMaxConcurrency(-5);
    expect(svc.getMaxConcurrency()).toBe(1);
    svc.setMaxConcurrency(999);
    expect(svc.getMaxConcurrency()).toBe(10);
    svc.setMaxConcurrency(4);
    expect(svc.getMaxConcurrency()).toBe(4);
  });
});

describe('WorkflowQueueService.enqueue', () => {
  test('タスクが存在しない場合 → エラーを投げ、重複チェックを行わないこと', async () => {
    const svc = new WorkflowQueueService();
    resolveTaskWorkflowStateMock.mockResolvedValueOnce(null);

    await expect(svc.enqueue({ taskId: 999 })).rejects.toThrow('Task 999 not found');
    expect(prismaMock.workflowQueueItem.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.workflowQueueItem.create).not.toHaveBeenCalled();
  });

  test('同一タスクが既にキューにある場合 → status を含むエラーを投げること', async () => {
    const svc = new WorkflowQueueService();
    resolveTaskWorkflowStateMock.mockResolvedValueOnce({
      id: 10,
      status: 'in-progress',
      workflowStatus: 'draft',
      workflowMode: 'standard',
      parentId: null,
    });
    prismaMock.workflowQueueItem.findFirst.mockResolvedValueOnce(row({ status: 'running' }));

    await expect(svc.enqueue({ taskId: 10 })).rejects.toThrow(
      'Task 10 is already in the queue (status: running)',
    );
    expect(prismaMock.workflowQueueItem.create).not.toHaveBeenCalled();
  });

  test('正常系 → デフォルト priority=50, dependencies=[] で作成すること', async () => {
    const svc = new WorkflowQueueService();
    resolveTaskWorkflowStateMock.mockResolvedValueOnce({
      id: 10,
      status: 'in-progress',
      workflowStatus: 'research_done',
      workflowMode: 'standard',
      parentId: null,
    });
    prismaMock.workflowQueueItem.create.mockResolvedValueOnce(
      row({ currentPhase: 'research_done' }),
    );

    const result = await svc.enqueue({ taskId: 10 });

    expect(prismaMock.workflowQueueItem.create).toHaveBeenCalledWith({
      data: {
        taskId: 10,
        orchestraSessionId: null,
        themeId: null,
        priority: 50,
        status: 'queued',
        currentPhase: 'research_done',
        dependencies: '[]',
      },
    });
    expect(result.priority).toBe(50);
    expect(result.dependencies).toEqual([]);
  });

  test('不正な workflowStatus は narrowWorkflowStatus のフォールバック(draft)になること', async () => {
    const svc = new WorkflowQueueService();
    resolveTaskWorkflowStateMock.mockResolvedValueOnce({
      id: 10,
      status: 'in-progress',
      workflowStatus: 'not-a-real-status',
      workflowMode: 'standard',
      parentId: null,
    });
    prismaMock.workflowQueueItem.create.mockResolvedValueOnce(row());

    await svc.enqueue({ taskId: 10 });

    const [callArgs] = prismaMock.workflowQueueItem.create.mock.calls[0] as [
      { data: { currentPhase: string } },
    ];
    expect(callArgs.data.currentPhase).toBe('draft');
  });

  test('priority/dependencies/orchestraSessionId/themeId を明示指定した場合 → そのまま渡すこと', async () => {
    const svc = new WorkflowQueueService();
    resolveTaskWorkflowStateMock.mockResolvedValueOnce({
      id: 10,
      status: 'in-progress',
      workflowStatus: 'draft',
      workflowMode: 'standard',
      parentId: null,
    });
    prismaMock.workflowQueueItem.create.mockResolvedValueOnce(row());

    await svc.enqueue({
      taskId: 10,
      priority: 80,
      dependencies: [1, 2],
      orchestraSessionId: 5,
      themeId: 3,
    });

    expect(prismaMock.workflowQueueItem.findFirst).toHaveBeenCalledWith({
      where: {
        taskId: 10,
        orchestraSessionId: 5,
        status: { in: ['queued', 'running', 'waiting_approval'] },
      },
    });
    const [callArgs] = prismaMock.workflowQueueItem.create.mock.calls[0] as [
      {
        data: {
          priority: number;
          dependencies: string;
          orchestraSessionId: number;
          themeId: number;
        };
      },
    ];
    expect(callArgs.data.priority).toBe(80);
    expect(callArgs.data.dependencies).toBe('[1,2]');
    expect(callArgs.data.orchestraSessionId).toBe(5);
    expect(callArgs.data.themeId).toBe(3);
  });
});
