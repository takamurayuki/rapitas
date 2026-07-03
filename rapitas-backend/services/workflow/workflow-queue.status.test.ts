/**
 * workflow-queue テスト（updateStatus / retryIfPossible / cancel / updatePriority）
 *
 * enqueue/concurrency設定は workflow-queue.test.ts、getQueueState 等は
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

describe('WorkflowQueueService.updateStatus', () => {
  test('status=completed の場合 → completedAt を設定すること', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.update.mockResolvedValueOnce(row({ status: 'completed' }));

    await svc.updateStatus(1, 'completed');

    const [callArgs] = prismaMock.workflowQueueItem.update.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(callArgs.data.status).toBe('completed');
    expect(callArgs.data.completedAt).toBeInstanceOf(Date);
  });

  test('status=failed の場合 → completedAt を設定すること', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.update.mockResolvedValueOnce(row({ status: 'failed' }));

    await svc.updateStatus(1, 'failed');

    const [callArgs] = prismaMock.workflowQueueItem.update.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(callArgs.data.completedAt).toBeInstanceOf(Date);
  });

  test('status=running の場合 → completedAt を設定しないこと', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.update.mockResolvedValueOnce(row({ status: 'running' }));

    await svc.updateStatus(1, 'running');

    const [callArgs] = prismaMock.workflowQueueItem.update.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(callArgs.data.completedAt).toBeUndefined();
  });

  test('extra フィールドが truthy な場合のみ data に含めること', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.update.mockResolvedValueOnce(row());

    await svc.updateStatus(1, 'in_progress', {
      currentPhase: 'plan_created',
      errorMessage: '',
      result: undefined,
    });

    const [callArgs] = prismaMock.workflowQueueItem.update.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(callArgs.data.currentPhase).toBe('plan_created');
    // Empty-string errorMessage is falsy — the `if (extra?.errorMessage)` guard
    // intentionally skips it rather than overwriting with a blank value.
    expect(callArgs.data.errorMessage).toBeUndefined();
    expect(callArgs.data.result).toBeUndefined();
  });

  test('extra が未指定の場合 → status のみ渡すこと', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.update.mockResolvedValueOnce(row());

    await svc.updateStatus(1, 'queued');

    expect(prismaMock.workflowQueueItem.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'queued' },
    });
  });
});

describe('WorkflowQueueService.retryIfPossible', () => {
  test('アイテムが存在しない場合 → false を返すこと', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(null);

    const result = await svc.retryIfPossible(1);

    expect(result).toBe(false);
    expect(prismaMock.workflowQueueItem.update).not.toHaveBeenCalled();
  });

  test.each(['cancelled', 'completed'])(
    'status=%s の場合 → false を返し更新しないこと（外部停止の尊重）',
    async (status) => {
      const svc = new WorkflowQueueService();
      prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(
        row({ status, retryCount: 0, maxRetries: 3 }),
      );

      const result = await svc.retryIfPossible(1);

      expect(result).toBe(false);
      expect(prismaMock.workflowQueueItem.update).not.toHaveBeenCalled();
    },
  );

  test.each([
    {
      name: 'reason 指定あり → 元の理由を含めて failed にすること',
      retryCount: 3,
      maxRetries: 3,
      reason: 'agent crashed',
      expectedMessage: 'Max retries (3) exceeded — last error: agent crashed',
    },
    {
      name: 'reason 未指定 → 汎用メッセージで failed にすること',
      retryCount: 5,
      maxRetries: 5,
      reason: undefined,
      expectedMessage: 'Max retries (5) exceeded',
    },
  ])(
    'retryCount >= maxRetries かつ $name',
    async ({ retryCount, maxRetries, reason, expectedMessage }) => {
      const svc = new WorkflowQueueService();
      prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(
        row({ status: 'running', retryCount, maxRetries }),
      );
      prismaMock.workflowQueueItem.update.mockResolvedValueOnce(row({ status: 'failed' }));

      const result = await svc.retryIfPossible(1, reason);

      expect(result).toBe(false);
      const [callArgs] = prismaMock.workflowQueueItem.update.mock.calls[0] as [
        { data: { status: string; errorMessage: string } },
      ];
      expect(callArgs.data.status).toBe('failed');
      expect(callArgs.data.errorMessage).toBe(expectedMessage);
    },
  );

  test('retryCount < maxRetries の場合 → queued に戻し retryCount を +1 すること', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(
      row({ status: 'running', retryCount: 1, maxRetries: 3 }),
    );

    const result = await svc.retryIfPossible(1, 'transient error');

    expect(result).toBe(true);
    expect(prismaMock.workflowQueueItem.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        status: 'queued',
        retryCount: 2,
        startedAt: null,
        errorMessage: 'transient error',
      },
    });
  });

  test('reason 未指定で再試行する場合 → errorMessage は null にすること', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(
      row({ status: 'running', retryCount: 0, maxRetries: 3 }),
    );

    await svc.retryIfPossible(1);

    const [callArgs] = prismaMock.workflowQueueItem.update.mock.calls[0] as [
      { data: { errorMessage: string | null } },
    ];
    expect(callArgs.data.errorMessage).toBeNull();
  });
});

describe('WorkflowQueueService.cancel', () => {
  test('status を cancelled に更新すること', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.update.mockResolvedValueOnce(row({ status: 'cancelled' }));

    const result = await svc.cancel(1);

    expect(prismaMock.workflowQueueItem.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'cancelled' },
    });
    expect(result.status).toBe('cancelled');
  });
});

describe('WorkflowQueueService.updatePriority', () => {
  test('負の値は 0 にクランプすること', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.update.mockResolvedValueOnce(row({ priority: 0 }));

    await svc.updatePriority(1, -10);

    expect(prismaMock.workflowQueueItem.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { priority: 0 },
    });
  });

  test('100 を超える値は 100 にクランプすること', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.update.mockResolvedValueOnce(row({ priority: 100 }));

    await svc.updatePriority(1, 500);

    expect(prismaMock.workflowQueueItem.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { priority: 100 },
    });
  });

  test('範囲内の値はそのまま渡すこと', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.update.mockResolvedValueOnce(row({ priority: 42 }));

    await svc.updatePriority(1, 42);

    expect(prismaMock.workflowQueueItem.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { priority: 42 },
    });
  });
});
