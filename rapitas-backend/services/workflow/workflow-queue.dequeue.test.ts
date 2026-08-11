/**
 * workflow-queue テスト（dequeue の依存関係・兄弟サブタスク直列化・
 * トランザクション競合ロジック）
 *
 * enqueue 等の他メソッドは workflow-queue.test.ts に分割する（ファイルサイズ制限のため）。
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
});

describe('WorkflowQueueService.dequeue — concurrency gate', () => {
  test('実行中の件数が maxConcurrency 以上の場合 → null を返し candidates を取得しないこと', async () => {
    const svc = new WorkflowQueueService();
    svc.setMaxConcurrency(2);
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(2);

    const result = await svc.dequeue();

    expect(result).toBeNull();
    expect(prismaMock.workflowQueueItem.findMany).not.toHaveBeenCalled();
  });

  test('候補が存在しない場合 → null を返すこと', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.findMany.mockResolvedValueOnce([]);

    const result = await svc.dequeue();

    expect(result).toBeNull();
  });
});

describe('WorkflowQueueService.dequeue — terminal-task guard', () => {
  test('タスクが完了済み(done)の場合 → キュー項目を cancelled にしてディスパッチしないこと', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.findMany.mockResolvedValueOnce([row({ id: 653, taskId: 537 })]);
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(0); // running count gate
    resolveTaskWorkflowStateMock.mockResolvedValueOnce({
      id: 537,
      status: 'done',
      workflowStatus: 'completed',
      workflowMode: 'standard',
      parentId: null,
    });

    const result = await svc.dequeue();

    expect(result).toBeNull();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.workflowQueueItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 653 },
        data: expect.objectContaining({ status: 'cancelled' }),
      }),
    );
  });

  test('タスク解決が null(一時的なDBエラーの可能性)の場合 → キャンセルせず従来どおり進むこと', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.findMany.mockResolvedValueOnce([row({ id: 2, taskId: 11 })]);
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(0); // running count gate
    // resolveTaskWorkflowState は beforeEach で null を返す設定のまま

    await svc.dequeue();

    // null では絶対にキャンセルしない(誤爆すると正当なキュー項目を破壊する)
    const cancelCalls = prismaMock.workflowQueueItem.update.mock.calls.filter(
      (c: unknown[]) => (c[0] as { data?: { status?: string } })?.data?.status === 'cancelled',
    );
    expect(cancelCalls.length).toBe(0);
  });
});

describe('WorkflowQueueService.dequeue — dependency check', () => {
  test('未完了の依存タスクがある場合 → その候補をスキップし null を返すこと', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.findMany.mockResolvedValueOnce([
      row({ id: 1, taskId: 10, dependencies: '[5]' }),
    ]);
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(0); // running count gate
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(1); // incompleteDeps > 0

    const result = await svc.dequeue();

    expect(result).toBeNull();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  test('依存タスクが全て完了している場合 → トランザクションへ進むこと', async () => {
    const svc = new WorkflowQueueService();
    prismaMock.workflowQueueItem.findMany.mockResolvedValueOnce([
      row({ id: 1, taskId: 10, dependencies: '[5]' }),
    ]);
    prismaMock.workflowQueueItem.count
      .mockResolvedValueOnce(0) // running count gate
      .mockResolvedValueOnce(0); // incompleteDeps
    resolveTaskWorkflowStateMock.mockResolvedValueOnce(null); // no parentId → skip sibling block
    prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(row({ id: 1, status: 'queued' }));
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(0); // tx concurrency re-check
    prismaMock.workflowQueueItem.update.mockResolvedValueOnce(row({ id: 1, status: 'running' }));

    const result = await svc.dequeue();

    expect(result?.id).toBe(1);
    expect(result?.status).toBe('running');
  });
});

describe('WorkflowQueueService.dequeue — sibling subtask serialization', () => {
  function primeUpToSiblingCheck(candidate: WorkflowQueueItemRow): void {
    prismaMock.workflowQueueItem.findMany.mockResolvedValueOnce([candidate]);
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(0); // running count gate
    resolveTaskWorkflowStateMock.mockResolvedValueOnce({
      id: candidate.taskId,
      status: 'in-progress',
      workflowStatus: 'in_progress',
      workflowMode: 'standard',
      parentId: 99,
    });
    prismaMock.task.findMany.mockResolvedValueOnce([{ id: 20 }, { id: 30 }]);
  }

  test('アクティブな兄弟サブタスクがある場合 → スキップし null を返すこと', async () => {
    const svc = new WorkflowQueueService();
    const candidate = row({ id: 1, taskId: 10 });
    primeUpToSiblingCheck(candidate);
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(1); // activeSibling > 0

    const result = await svc.dequeue();

    expect(result).toBeNull();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  test('先に作成された兄弟が pending の場合 → スキップし null を返すこと', async () => {
    const svc = new WorkflowQueueService();
    const candidate = row({ id: 1, taskId: 25 });
    primeUpToSiblingCheck(candidate);
    prismaMock.workflowQueueItem.count
      .mockResolvedValueOnce(0) // activeSibling
      .mockResolvedValueOnce(1); // earlierPending (sibling id 20 < 25)

    const result = await svc.dequeue();

    expect(result).toBeNull();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  test('アクティブ兄弟なし・先行兄弟なしの場合 → トランザクションへ進むこと', async () => {
    const svc = new WorkflowQueueService();
    const candidate = row({ id: 1, taskId: 10 }); // taskId 10 < both siblings (20, 30)
    primeUpToSiblingCheck(candidate);
    // siblingIds = [20, 30]; earlierIds = siblings with id < 10 → empty, so
    // only the activeSibling count is queried before the earlier-pending branch.
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(0); // activeSibling
    prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(row({ id: 1, status: 'queued' }));
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(0); // tx concurrency re-check
    prismaMock.workflowQueueItem.update.mockResolvedValueOnce(row({ id: 1, status: 'running' }));

    const result = await svc.dequeue();

    expect(result?.id).toBe(1);
  });

  test('兄弟が存在しない(parentId ありだが siblings=[])場合 → 直列化チェックをスキップすること', async () => {
    const svc = new WorkflowQueueService();
    const candidate = row({ id: 1, taskId: 10 });
    prismaMock.workflowQueueItem.findMany.mockResolvedValueOnce([candidate]);
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(0); // running count gate
    resolveTaskWorkflowStateMock.mockResolvedValueOnce({
      id: 10,
      status: 'in-progress',
      workflowStatus: 'in_progress',
      workflowMode: 'standard',
      parentId: 99,
    });
    prismaMock.task.findMany.mockResolvedValueOnce([]); // no siblings
    prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(row({ id: 1, status: 'queued' }));
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(0); // tx concurrency re-check
    prismaMock.workflowQueueItem.update.mockResolvedValueOnce(row({ id: 1, status: 'running' }));

    const result = await svc.dequeue();

    expect(result?.id).toBe(1);
  });
});

describe('WorkflowQueueService.dequeue — transactional race protection', () => {
  function primeToTransaction(candidate: WorkflowQueueItemRow): void {
    prismaMock.workflowQueueItem.findMany.mockResolvedValueOnce([candidate]);
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(0); // running count gate
    resolveTaskWorkflowStateMock.mockResolvedValueOnce(null); // no parentId
  }

  test('別ワーカーに既に取得された場合(status!=queued) → 次の候補が無ければ null', async () => {
    const svc = new WorkflowQueueService();
    const candidate = row({ id: 1 });
    primeToTransaction(candidate);
    prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(
      row({ id: 1, status: 'running' }),
    );

    const result = await svc.dequeue();

    expect(result).toBeNull();
    expect(prismaMock.workflowQueueItem.update).not.toHaveBeenCalled();
  });

  test('current が既に取得されnullの場合(該当行なし) → null', async () => {
    const svc = new WorkflowQueueService();
    const candidate = row({ id: 1 });
    primeToTransaction(candidate);
    prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(null);

    const result = await svc.dequeue();

    expect(result).toBeNull();
  });

  test('トランザクション内で concurrency 上限に達した場合 → null', async () => {
    const svc = new WorkflowQueueService();
    svc.setMaxConcurrency(1);
    const candidate = row({ id: 1 });
    primeToTransaction(candidate);
    prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(row({ id: 1, status: 'queued' }));
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(1); // tx re-check: at limit (maxConcurrency=1)

    const result = await svc.dequeue();

    expect(result).toBeNull();
    expect(prismaMock.workflowQueueItem.update).not.toHaveBeenCalled();
  });

  test('候補処理中に例外が発生した場合 → warn ログを出し次の候補へ進むこと', async () => {
    const svc = new WorkflowQueueService();
    const bad = row({ id: 1, taskId: 10, dependencies: 'not-json' });
    const good = row({ id: 2, taskId: 11, dependencies: '[]' });
    prismaMock.workflowQueueItem.findMany.mockResolvedValueOnce([bad, good]);
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(0); // running count gate
    resolveTaskWorkflowStateMock.mockResolvedValueOnce(null); // for `good` candidate
    prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(row({ id: 2, status: 'queued' }));
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(0); // tx concurrency re-check
    prismaMock.workflowQueueItem.update.mockResolvedValueOnce(row({ id: 2, status: 'running' }));

    const result = await svc.dequeue();

    expect(result?.id).toBe(2);
    expect(noopLogger.warn).toHaveBeenCalledTimes(1);
  });

  test('正常系 → status を running に更新し startedAt を設定すること', async () => {
    const svc = new WorkflowQueueService();
    const candidate = row({ id: 1, taskId: 10 });
    primeToTransaction(candidate);
    prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(row({ id: 1, status: 'queued' }));
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(0);
    prismaMock.workflowQueueItem.update.mockResolvedValueOnce(row({ id: 1, status: 'running' }));

    const result = await svc.dequeue();

    expect(prismaMock.workflowQueueItem.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'running', startedAt: expect.any(Date) },
    });
    expect(result?.status).toBe('running');
  });

  test('優先度・キュー時刻の順で candidates を取得すること', async () => {
    const svc = new WorkflowQueueService();
    await svc.dequeue();

    expect(prismaMock.workflowQueueItem.findMany).toHaveBeenCalledWith({
      where: { status: 'queued' },
      orderBy: [{ priority: 'desc' }, { queuedAt: 'asc' }],
    });
  });
});
