/**
 * queue-dequeue-candidate テスト（task 954: 無音スキップ分岐での
 * task.dequeue_skipped 発火 — overlap 保留中タスクのみ限定）
 *
 * dequeue() 経由の依存関係・兄弟サブタスク直列化ロジック自体は
 * workflow-queue.dequeue.test.ts でカバー済み。このファイルは
 * tryDequeueCandidate() を直接呼び出し、各無音 return null 分岐と
 * canAcquireRepairQueue 拒否分岐で isOverlapHeld() の真偽により
 * task.dequeue_skipped の発火有無が切り替わることを検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const themeRunning = mock(async () => true);
mock.module('./queue-theme-guard', () => ({ isQueueThemeRunning: themeRunning }));

const overlapHeld = mock((_taskId: number) => false);
mock.module('./workflow-orchestrator-overlap-guard', () => ({ isOverlapHeld: overlapHeld }));

const cycleEvents: Array<{ evt: string; fields: Record<string, unknown> }> = [];
mock.module('../observability', () => ({
  logCycleEvent: (evt: string, fields: Record<string, unknown>) => {
    cycleEvents.push({ evt, fields });
  },
}));

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
  result?: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface FakePrisma {
  workflowQueueItem: {
    findMany: MockFn;
    count: MockFn;
    update: MockFn;
    findUnique: MockFn;
  };
  task: { findMany: MockFn };
  $transaction: MockFn;
}

function makePrisma(): FakePrisma {
  const p: FakePrisma = {
    workflowQueueItem: {
      findMany: mock(() => Promise.resolve([])),
      count: mock(() => Promise.resolve(0)),
      update: mock(() => Promise.resolve(null)),
      findUnique: mock(() => Promise.resolve(null)),
    },
    task: { findMany: mock(() => Promise.resolve([])) },
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
const taskRowConfirmedAbsentMock = mock((_taskId: number) => Promise.resolve(false));

mock.module('../task/task-resolver', () => ({
  resolveTaskWorkflowState: resolveTaskWorkflowStateMock,
  taskRowConfirmedAbsent: taskRowConfirmedAbsentMock,
}));

const { tryDequeueCandidate } = await import('./queue-dequeue-candidate');

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
    result: null,
    queuedAt: new Date('2026-01-01T00:00:00Z'),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  themeRunning.mockReset().mockResolvedValue(true);
  overlapHeld.mockReset().mockReturnValue(false);
  cycleEvents.length = 0;
  prismaMock.workflowQueueItem.findMany.mockReset().mockResolvedValue([]);
  prismaMock.workflowQueueItem.count.mockReset().mockResolvedValue(0);
  prismaMock.workflowQueueItem.update.mockReset().mockResolvedValue(null);
  prismaMock.workflowQueueItem.findUnique.mockReset().mockResolvedValue(null);
  prismaMock.task.findMany.mockReset().mockResolvedValue([]);
  prismaMock.$transaction
    .mockReset()
    .mockImplementation((cb: (tx: FakePrisma) => unknown) => cb(prismaMock));
  resolveTaskWorkflowStateMock.mockReset().mockResolvedValue(null);
  taskRowConfirmedAbsentMock.mockReset().mockResolvedValue(false);
});

describe('tryDequeueCandidate — dependency_incomplete', () => {
  test('overlap 保留中は task.dequeue_skipped(dependency_incomplete) を発火する', async () => {
    overlapHeld.mockReturnValue(true);
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(1); // incompleteDeps > 0

    const result = await tryDequeueCandidate(row({ dependencies: '[5]' }), 5);

    expect(result).toBeNull();
    expect(cycleEvents).toEqual([
      {
        evt: 'task.dequeue_skipped',
        fields: expect.objectContaining({ task: 10, reason: 'dependency_incomplete' }),
      },
    ]);
  });

  test('overlap 保留中でなければ発火しない', async () => {
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(1); // incompleteDeps > 0

    const result = await tryDequeueCandidate(row({ dependencies: '[5]' }), 5);

    expect(result).toBeNull();
    expect(cycleEvents.length).toBe(0);
  });
});

describe('tryDequeueCandidate — theme_not_running', () => {
  test('overlap 保留中は task.dequeue_skipped(theme_not_running) を発火する', async () => {
    overlapHeld.mockReturnValue(true);
    themeRunning.mockResolvedValue(false);
    prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(row({ status: 'queued' }));

    const result = await tryDequeueCandidate(row(), 5);

    expect(result).toBeNull();
    expect(cycleEvents).toEqual([
      {
        evt: 'task.dequeue_skipped',
        fields: expect.objectContaining({ task: 10, reason: 'theme_not_running' }),
      },
    ]);
  });

  test('overlap 保留中でなければ発火しない', async () => {
    themeRunning.mockResolvedValue(false);
    prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(row({ status: 'queued' }));

    const result = await tryDequeueCandidate(row(), 5);

    expect(result).toBeNull();
    expect(cycleEvents.length).toBe(0);
  });
});

describe('tryDequeueCandidate — sibling_active / sibling_earlier_pending', () => {
  function primeSiblingCandidate(taskId: number): WorkflowQueueItemRow {
    resolveTaskWorkflowStateMock.mockResolvedValueOnce({
      id: taskId,
      status: 'in-progress',
      workflowStatus: 'in_progress',
      workflowMode: 'standard',
      parentId: 99,
    });
    prismaMock.task.findMany.mockResolvedValueOnce([{ id: 20 }, { id: 30 }]);
    return row({ taskId });
  }

  test('アクティブな兄弟がいる場合、overlap 保留中は sibling_active を発火する', async () => {
    overlapHeld.mockReturnValue(true);
    const candidate = primeSiblingCandidate(10);
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(1); // activeSibling > 0

    const result = await tryDequeueCandidate(candidate, 5);

    expect(result).toBeNull();
    expect(cycleEvents).toEqual([
      {
        evt: 'task.dequeue_skipped',
        fields: expect.objectContaining({ task: 10, reason: 'sibling_active' }),
      },
    ]);
  });

  test('アクティブな兄弟がいる場合、overlap 保留中でなければ発火しない', async () => {
    const candidate = primeSiblingCandidate(10);
    prismaMock.workflowQueueItem.count.mockResolvedValueOnce(1); // activeSibling > 0

    const result = await tryDequeueCandidate(candidate, 5);

    expect(result).toBeNull();
    expect(cycleEvents.length).toBe(0);
  });

  test('先行兄弟が pending の場合、overlap 保留中は sibling_earlier_pending を発火する', async () => {
    overlapHeld.mockReturnValue(true);
    const candidate = primeSiblingCandidate(25); // taskId 25 > sibling id 20
    prismaMock.workflowQueueItem.count
      .mockResolvedValueOnce(0) // activeSibling
      .mockResolvedValueOnce(1); // earlierPending

    const result = await tryDequeueCandidate(candidate, 5);

    expect(result).toBeNull();
    expect(cycleEvents).toEqual([
      {
        evt: 'task.dequeue_skipped',
        fields: expect.objectContaining({ task: 25, reason: 'sibling_earlier_pending' }),
      },
    ]);
  });

  test('先行兄弟が pending の場合、overlap 保留中でなければ発火しない', async () => {
    const candidate = primeSiblingCandidate(25);
    prismaMock.workflowQueueItem.count
      .mockResolvedValueOnce(0) // activeSibling
      .mockResolvedValueOnce(1); // earlierPending

    const result = await tryDequeueCandidate(candidate, 5);

    expect(result).toBeNull();
    expect(cycleEvents.length).toBe(0);
  });
});

describe('tryDequeueCandidate — repair_admission_denied', () => {
  const deniedResult = JSON.stringify({ repairResume: { updatedAt: 'invalid' } });

  test('overlap 保留中は cancelled 化せず task.dequeue_skipped(repair_admission_denied) を発火する', async () => {
    overlapHeld.mockReturnValue(true);
    prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(
      row({ status: 'queued', result: deniedResult }),
    );

    const result = await tryDequeueCandidate(row(), 5);

    expect(result).toBeNull();
    expect(prismaMock.workflowQueueItem.update).not.toHaveBeenCalled();
    expect(cycleEvents).toEqual([
      {
        evt: 'task.dequeue_skipped',
        fields: expect.objectContaining({ task: 10, reason: 'repair_admission_denied' }),
      },
    ]);
  });

  test('overlap 保留中でなければ従来どおり cancelled 化し、発火しない', async () => {
    prismaMock.workflowQueueItem.findUnique.mockResolvedValueOnce(
      row({ status: 'queued', result: deniedResult }),
    );

    const result = await tryDequeueCandidate(row(), 5);

    expect(result).toBeNull();
    expect(prismaMock.workflowQueueItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ status: 'cancelled' }),
      }),
    );
    expect(cycleEvents.length).toBe(0);
  });
});
