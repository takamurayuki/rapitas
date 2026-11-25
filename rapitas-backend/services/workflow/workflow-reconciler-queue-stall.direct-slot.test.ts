/**
 * workflow-reconciler-queue-stall.direct-slot.test
 *
 * task 1535: a `running` WorkflowQueueItem left behind by a direct advance (workflow-direct-slot,
 * e.g. the process died before the finally-release) is reclaimed by the existing stale-running
 * sweep after RUNNING_ITEM_STALE_MS (40 min) when no live execution backs it, and never while one
 * does. The 40 min threshold is distinct from the 5 min heartbeat freshness window of
 * hasLiveExecution. Split from workflow-reconciler-queue-stall.test.ts (size limit).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { RUNNING_ITEM_STALE_MS, QUEUE_STARVATION_THRESHOLD_MS } from './queue-stall-policy';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const findManyMock = mock(() =>
  Promise.resolve([] as { id: number; taskId: number; themeId: number | null }[]),
);
const updateManyMock = mock(() => Promise.resolve({ count: 1 }));
const countMock = mock(() => Promise.resolve(0));
const findFirstMock = mock(() => Promise.resolve(null as { taskId: number } | null));
// task 1105: the sweep also asks which tasks cannot run at all (halted /
// blocked). Default empty keeps every pre-existing case on the age-only path.
const taskFindManyMock = mock(() => Promise.resolve([] as { id: number }[]));
const mockPrisma = {
  workflowQueueItem: {
    findMany: findManyMock,
    updateMany: updateManyMock,
    count: countMock,
    findFirst: findFirstMock,
  },
  task: { findMany: taskFindManyMock },
};

const resolveTaskWorkflowStateMock = mock(() =>
  Promise.resolve<{ status?: string | null; workflowStatus?: string | null } | null>(null),
);
const hasLiveExecutionMock = mock(() => Promise.resolve(false));
const startProcessingMock = mock(() => {});
const releaseQueueItemMock = mock((_id: number) => true);
// 既定は「ランナー停止中」= kick が有効な状況。稼働中の分岐は個別テストで切り替える。
const isProcessingMock = mock(() => false);
const notifyStallReleasedMock = mock(() => Promise.resolve());
const notifyQueueStarvationMock = mock(() => Promise.resolve());
const notifyQueueStalledRunnerAliveMock = mock(() => Promise.resolve());
const logCycleEventMock = mock(() => {});

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../task/task-resolver', () => ({
  resolveTaskWorkflowState: resolveTaskWorkflowStateMock,
}));
// Mirror of the real pure predicate (positive terminal evidence only).
mock.module('./workflow-queue', () => ({
  isTaskTerminalForQueue: (
    task: { status?: string | null; workflowStatus?: string | null } | null,
  ) =>
    !!task &&
    (task.status === 'done' || task.status === 'cancelled' || task.workflowStatus === 'completed'),
}));
mock.module('./workflow-runner', () => ({
  WorkflowRunner: {
    getInstance: () => ({
      startProcessing: startProcessingMock,
      isProcessing: isProcessingMock,
      releaseQueueItem: releaseQueueItemMock,
    }),
  },
}));
mock.module('./auto-run/auto-run-selection', () => ({
  hasLiveExecution: hasLiveExecutionMock,
}));
mock.module('./auto-run/auto-run-notifications', () => ({
  notifyStallReleased: notifyStallReleasedMock,
  notifyQueueStarvation: notifyQueueStarvationMock,
  notifyQueueStalledRunnerAlive: notifyQueueStalledRunnerAliveMock,
}));
mock.module('../observability', () => ({
  logCycleEvent: logCycleEventMock,
  getCycleLogFilePath: () => '/tmp/cycle.ndjson',
}));

const { sweepStaleRunningItems } = await import('./workflow-reconciler-queue-stall');

const NOW = 1_800_000_000_000;
const DIRECT_ITEM = { id: 9001, taskId: 1420, themeId: 35 };

beforeEach(() => {
  findManyMock.mockReset().mockResolvedValue([]);
  taskFindManyMock.mockReset().mockResolvedValue([]);
  updateManyMock.mockReset().mockResolvedValue({ count: 1 });
  countMock.mockReset().mockResolvedValue(0);
  findFirstMock.mockReset().mockResolvedValue(null);
  resolveTaskWorkflowStateMock.mockReset().mockResolvedValue({
    status: 'in-progress',
    workflowStatus: 'in_progress',
  });
  hasLiveExecutionMock.mockReset().mockResolvedValue(false);
  releaseQueueItemMock.mockReset().mockReturnValue(true);
  notifyStallReleasedMock.mockReset().mockResolvedValue(undefined);
  logCycleEventMock.mockReset();
});

describe('sweepStaleRunningItems — 直接実行の予約 (task 1535)', () => {
  test('40 分超過かつ生存実行なしの予約由来 running は回収され、CAS は running 条件', async () => {
    findManyMock.mockResolvedValue([DIRECT_ITEM]);
    expect(await sweepStaleRunningItems(NOW)).toBe(1);
    const call = updateManyMock.mock.calls[0]?.[0] as { where: unknown };
    expect(call.where).toEqual({ id: 9001, status: 'running' });
    expect(logCycleEventMock).toHaveBeenCalledWith(
      'task.stall_released',
      expect.objectContaining({ task: 1420, cause: 'stale_running_no_live_execution' }),
    );
  });

  test('生存実行がある予約由来 running は 40 分超過でも回収しない', async () => {
    findManyMock.mockResolvedValue([DIRECT_ITEM]);
    hasLiveExecutionMock.mockResolvedValue(true);
    expect(await sweepStaleRunningItems(NOW)).toBe(0);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  test('候補の抽出条件は startedAt が 40 分より古いもの（40 分未満は候補にならない）', async () => {
    await sweepStaleRunningItems(NOW);
    const where = (findManyMock.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(where).toEqual({
      status: 'running',
      startedAt: { lt: new Date(NOW - RUNNING_ITEM_STALE_MS) },
    });
    expect(RUNNING_ITEM_STALE_MS).toBe(40 * 60 * 1000);
  });
});
