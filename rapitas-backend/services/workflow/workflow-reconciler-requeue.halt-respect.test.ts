/**
 * workflow-reconciler-requeue — iteration budget で halt 済み(haltReason 付き)タスクの保護 (task 1002)
 *
 * halt は Task.status を変えず haltReason だけを記録するため、requeue 側の findMany が
 * haltReason を除外しないと stale 判定で todo に戻され exec が再開・完走する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  task: {
    findMany: mock((..._args: unknown[]) => Promise.resolve([] as unknown[])),
    update: mock(() => Promise.resolve({})),
  },
  themeAutoRun: {
    findMany: mock(() => Promise.resolve([{ themeId: 1 }] as unknown[])),
  },
  userSettings: { findFirst: mock(() => Promise.resolve(null as unknown)) },
  agentExecution: { findFirst: mock(() => Promise.resolve(null as unknown)) },
  workflowQueueItem: { findFirst: mock(async (): Promise<{ id: number } | null> => null) },
  workflowTransition: { count: mock(() => Promise.resolve(0)) },
};

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
mock.module('./transition-recorder', () => ({ recordTransition: () => Promise.resolve() }));
mock.module('./verify-settle-artifact-recovery', () => ({
  isAwaitingRequiredMerge: () => Promise.resolve(false),
}));

const { requeueOrphanTasks, requeueBlockedTasks } = await import('./workflow-reconciler-requeue');

const NOW = 1_800_000_000_000;

beforeEach(() => {
  mockPrisma.task.findMany.mockReset().mockResolvedValue([]);
});

describe('reconciler requeue は haltReason 付きタスクを対象にしない', () => {
  test('requeueOrphanTasks の findMany は haltReason: null で絞る', async () => {
    await requeueOrphanTasks(NOW);
    const arg = mockPrisma.task.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where.haltReason).toBeNull();
  });

  test('requeueBlockedTasks の findMany は haltReason: null で絞る', async () => {
    await requeueBlockedTasks(NOW);
    const arg = mockPrisma.task.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where.haltReason).toBeNull();
  });
});

describe('requeueBlockedTasks は完了済みワークフローを draft に戻さない (task 1125)', () => {
  test('workflowStatus=completed の blocked タスクは status=done へ復元し draft にしない', async () => {
    mockPrisma.task.findMany.mockResolvedValueOnce([{ id: 1114, workflowStatus: 'completed' }]);
    (mockPrisma as Record<string, unknown>).activityLog = {
      findFirst: mock(() => Promise.resolve(null)),
    };
    mockPrisma.task.update.mockClear();

    await requeueBlockedTasks(NOW);

    const updates = (mockPrisma.task.update.mock.calls as unknown[][]).map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );
    expect(updates.some((d) => d.workflowStatus === 'draft')).toBe(false);
    expect(updates.some((d) => d.status === 'done')).toBe(true);
  });
});
