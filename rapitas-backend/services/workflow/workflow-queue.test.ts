/**
 * workflow-queue テスト（concurrency設定と実行経路への反映 / enqueue）
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

// 実行可否を固定し、実 DB に接続せずに実際の dequeue と取得トランザクションを通す。
mock.module('./queue-provider-gate', () => ({
  hasUsableProvider: mock(async () => true),
  isProviderOutageFailure: mock(async () => false),
}));
mock.module('./queue-theme-guard', () => ({
  isQueueThemeRunning: mock(async () => true),
}));

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

  // task 1543: the auto-run setting must lift the runner's cap too, or a 2nd
  // selected theme would sit queued behind a cap of 1.
  test('setAutoRunConcurrency(2) で実行キューの上限が 2 になること', () => {
    const svc = new WorkflowQueueService();
    svc.setAutoRunConcurrency(2);
    expect(svc.getMaxConcurrency()).toBe(2);
  });

  test('AIOrchestra の上書きと自動実行の上限は大きい方を採ること', () => {
    const svc = new WorkflowQueueService();
    svc.setMaxConcurrency(3);
    svc.setAutoRunConcurrency(2);
    expect(svc.getMaxConcurrency()).toBe(3);
    svc.setMaxConcurrency(1);
    expect(svc.getMaxConcurrency()).toBe(2);
    svc.setAutoRunConcurrency(99);
    expect(svc.getMaxConcurrency()).toBe(10);
  });
});

describe('WorkflowQueueService — 自動実行の実効上限', () => {
  function prepareDequeue(runningBefore: number, runningInTransaction: number) {
    const svc = new WorkflowQueueService();
    svc.setMaxConcurrency(1);
    svc.setAutoRunConcurrency(2);
    prismaMock.workflowQueueItem.count
      .mockResolvedValueOnce(runningBefore)
      .mockResolvedValueOnce(runningInTransaction);
    prismaMock.workflowQueueItem.findMany.mockResolvedValueOnce([row()]);
    prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(row());
    prismaMock.workflowQueueItem.update.mockResolvedValueOnce(row({ status: 'running' }));
    return svc;
  }

  test.each([1, 0])('入口の実行数%d・取得時1件なら上限2で次の項目を実行できる', async (before) => {
    const svc = prepareDequeue(before, 1);

    expect((await svc.dequeue())?.status).toBe('running');
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.workflowQueueItem.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'running', startedAt: expect.any(Date) },
    });
  });

  test.each([2, 1])('入口の実行数%d・取得時2件なら上限2を超えて開始しない', async (before) => {
    const svc = prepareDequeue(before, 2);

    expect(await svc.dequeue()).toBeNull();
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(before === 2 ? 0 : 1);
    expect(prismaMock.workflowQueueItem.update).not.toHaveBeenCalled();
  });

  test('上限を2から1へ下げても実行中項目を変更せず追加取得だけを止める', async () => {
    const svc = prepareDequeue(1, 1);
    svc.setAutoRunConcurrency(1);

    expect(await svc.dequeue()).toBeNull();
    expect(prismaMock.workflowQueueItem.findMany).not.toHaveBeenCalled();
    expect(prismaMock.workflowQueueItem.update).not.toHaveBeenCalled();
    expect(prismaMock.workflowQueueItem.updateMany).not.toHaveBeenCalled();
  });

  test('上限2なら異なる2テーマを実行し、3テーマ目はキューに残す', async () => {
    const svc = new WorkflowQueueService();
    svc.setMaxConcurrency(1);
    svc.setAutoRunConcurrency(2);
    const items = [1, 35, 50].map((themeId) => ({
      ...row({ id: themeId, taskId: themeId }),
      themeId,
    }));
    prismaMock.workflowQueueItem.count.mockImplementation(
      async () => items.filter((item) => item.status === 'running').length,
    );
    prismaMock.workflowQueueItem.findMany.mockImplementation(async () =>
      items.filter((item) => item.status === 'queued'),
    );
    prismaMock.workflowQueueItem.findUnique.mockImplementation(
      async ({ where }: { where: { id: number } }) => items.find((item) => item.id === where.id),
    );
    prismaMock.workflowQueueItem.update.mockImplementation(
      async ({ where, data }: { where: { id: number }; data: Partial<WorkflowQueueItemRow> }) =>
        Object.assign(items.find((item) => item.id === where.id)!, data),
    );

    expect((await svc.dequeue())?.taskId).toBe(1);
    expect((await svc.dequeue())?.taskId).toBe(35);
    expect(await svc.dequeue()).toBeNull();
    expect(items.map((item) => item.status)).toEqual(['running', 'running', 'queued']);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  test.each([
    [1, 2, 2],
    [3, 2, 3],
    [1, 1, 1],
  ])(
    '空キューでも通常上限%d・自動実行上限%dの実効値%dを状態に返す',
    async (base, auto, expected) => {
      const svc = new WorkflowQueueService();
      svc.setMaxConcurrency(base);
      svc.setAutoRunConcurrency(auto);

      const state = await svc.getQueueState();

      expect(state.maxConcurrency).toBe(expected);
      expect(state.totalItems).toBe(0);
    },
  );
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
