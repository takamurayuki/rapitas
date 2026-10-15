/**
 * workflow-queue-overlap-continuity テスト（task 954）
 *
 * 受入条件1「呼び出しが継続しているか」を推論ではなく実測で裏付ける統合テスト。
 * WorkflowQueueService.dequeue() を180回（10秒間隔ポーリング30分相当）繰り返し、
 * overlap 保留中タスク（950/951/953を模す）それぞれについて、毎回
 * tryDequeueCandidate() が候補として評価されることを呼び出し回数で確認する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const POLL_COUNT = 180;

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

mock.module('./queue-provider-gate', () => ({
  hasUsableProvider: mock(() => Promise.resolve(true)),
  isProviderOutageFailure: mock(() => Promise.resolve(false)),
}));

// The candidate loop itself (workflow-queue.ts::dequeue()) is under test —
// tryDequeueCandidate() is mocked to isolate "was every candidate evaluated
// this poll" from its internal dispatch decisions (covered elsewhere).
const tryDequeueCandidateMock = mock(async () => null);
mock.module('./queue-dequeue-candidate', () => ({
  tryDequeueCandidate: tryDequeueCandidateMock,
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
  workflowQueueItem: { findMany: MockFn; count: MockFn };
}

const prismaMock: FakePrisma = {
  workflowQueueItem: {
    findMany: mock(() => Promise.resolve([])),
    count: mock(() => Promise.resolve(0)),
  },
};

mock.module('../../config', () => ({
  prisma: prismaMock,
  createLogger: () => noopLogger,
  logger: noopLogger,
  ensureDatabaseConnection: () => Promise.resolve(),
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => 'default',
  getProjectRoot: () => '/tmp/rapitas-test',
}));

const { WorkflowQueueService } = await import('./workflow-queue');

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
  tryDequeueCandidateMock.mockReset().mockResolvedValue(null);
  prismaMock.workflowQueueItem.findMany.mockReset().mockResolvedValue([]);
  prismaMock.workflowQueueItem.count.mockReset().mockResolvedValue(0);
});

describe('WorkflowQueueService.dequeue — overlap-held candidate continuity (task 950/951/953 相当)', () => {
  test('単一の overlap 保留タスクは180回のポーリング全てで候補評価される', async () => {
    const candidate = row({ id: 1, taskId: 950 });
    prismaMock.workflowQueueItem.findMany.mockResolvedValue([candidate]);

    const svc = new WorkflowQueueService();
    for (let i = 0; i < POLL_COUNT; i++) {
      await svc.dequeue();
    }

    expect(tryDequeueCandidateMock).toHaveBeenCalledTimes(POLL_COUNT);
    for (const call of tryDequeueCandidateMock.mock.calls) {
      expect((call[0] as WorkflowQueueItemRow).taskId).toBe(950);
    }
  });

  test('950/951/953を模した複数タスク同時保留は各taskIdが独立して毎ポーリング評価される', async () => {
    const candidates = [
      row({ id: 1, taskId: 950 }),
      row({ id: 2, taskId: 951 }),
      row({ id: 3, taskId: 953 }),
    ];
    prismaMock.workflowQueueItem.findMany.mockResolvedValue(candidates);

    const svc = new WorkflowQueueService();
    for (let i = 0; i < POLL_COUNT; i++) {
      await svc.dequeue();
    }

    // Each poll's candidate loop stops at the first non-null result (fresh
    // dispatch) or exhausts the list; since every candidate resolves null
    // here, all three are evaluated on every poll.
    expect(tryDequeueCandidateMock).toHaveBeenCalledTimes(POLL_COUNT * candidates.length);
    const evaluatedTaskIds = tryDequeueCandidateMock.mock.calls.map(
      (call) => (call[0] as WorkflowQueueItemRow).taskId,
    );
    for (const taskId of [950, 951, 953]) {
      expect(evaluatedTaskIds.filter((id) => id === taskId).length).toBe(POLL_COUNT);
    }
  });
});
