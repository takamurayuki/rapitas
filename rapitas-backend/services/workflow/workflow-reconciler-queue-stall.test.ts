/**
 * workflow-reconciler-queue-stall.test
 *
 * Covers the two task-618 heal passes:
 *  - sweepStaleRunningItems: stale 'running' residue is CAS-cancelled when the
 *    task is terminal OR has no live execution; a live non-terminal phase is
 *    never touched (double-agent regression guard).
 *  - detectQueueStarvation: `running=0 かつ queued>0` must PERSIST past the
 *    threshold before the runner is kicked — first observations and phase-gap
 *    transients (task 585) never fire.
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
const mockPrisma = {
  workflowQueueItem: {
    findMany: findManyMock,
    updateMany: updateManyMock,
    count: countMock,
    findFirst: findFirstMock,
  },
};

const resolveTaskWorkflowStateMock = mock(() =>
  Promise.resolve<{ status?: string | null; workflowStatus?: string | null } | null>(null),
);
const hasLiveExecutionMock = mock(() => Promise.resolve(false));
const startProcessingMock = mock(() => {});
const notifyStallReleasedMock = mock(() => Promise.resolve());
const notifyQueueStarvationMock = mock(() => Promise.resolve());
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
    getInstance: () => ({ startProcessing: startProcessingMock }),
  },
}));
mock.module('./auto-run/auto-run-selection', () => ({
  hasLiveExecution: hasLiveExecutionMock,
}));
mock.module('./auto-run/auto-run-notifications', () => ({
  notifyStallReleased: notifyStallReleasedMock,
  notifyQueueStarvation: notifyQueueStarvationMock,
}));
mock.module('../observability', () => ({
  logCycleEvent: logCycleEventMock,
  getCycleLogFilePath: () => '/tmp/cycle.ndjson',
}));

const { sweepStaleRunningItems, detectQueueStarvation, resetQueueStarvationTracker } = await import(
  './workflow-reconciler-queue-stall'
);

const NOW = 1_800_000_000_000;

beforeEach(() => {
  findManyMock.mockReset().mockResolvedValue([]);
  updateManyMock.mockReset().mockResolvedValue({ count: 1 });
  countMock.mockReset().mockResolvedValue(0);
  findFirstMock.mockReset().mockResolvedValue(null);
  resolveTaskWorkflowStateMock.mockReset().mockResolvedValue(null);
  hasLiveExecutionMock.mockReset().mockResolvedValue(false);
  startProcessingMock.mockReset();
  notifyStallReleasedMock.mockReset().mockResolvedValue(undefined);
  notifyQueueStarvationMock.mockReset().mockResolvedValue(undefined);
  logCycleEventMock.mockReset();
  resetQueueStarvationTracker();
});

describe('sweepStaleRunningItems', () => {
  test('no stale candidates short-circuits without task lookups', async () => {
    const released = await sweepStaleRunningItems(NOW);

    expect(released).toBe(0);
    expect(resolveTaskWorkflowStateMock).not.toHaveBeenCalled();
    const where = (findManyMock.mock.calls[0]?.[0] as { where: { status: string; startedAt: { lt: Date } } })
      .where;
    expect(where.status).toBe('running');
    expect(where.startedAt.lt.getTime()).toBe(NOW - RUNNING_ITEM_STALE_MS);
  });

  test('a terminal (done) task の running 残留は cancel される（事例2の残留元回収）', async () => {
    findManyMock.mockResolvedValue([{ id: 21, taskId: 617, themeId: 1 }]);
    resolveTaskWorkflowStateMock.mockResolvedValue({ status: 'done', workflowStatus: null });

    const released = await sweepStaleRunningItems(NOW);

    expect(released).toBe(1);
    const call = updateManyMock.mock.calls[0]?.[0] as {
      where: { id: number; status: string };
      data: { status: string };
    };
    expect(call.where).toEqual({ id: 21, status: 'running' });
    expect(call.data.status).toBe('cancelled');
    // Liveness is irrelevant for a terminal task — never even consulted.
    expect(hasLiveExecutionMock).not.toHaveBeenCalled();
    expect(logCycleEventMock).toHaveBeenCalledWith(
      'task.stall_released',
      expect.objectContaining({ task: 617, cause: 'terminal_task_running_residue' }),
    );
    expect(notifyStallReleasedMock).toHaveBeenCalledWith(
      1,
      617,
      1,
      'terminal_task_running_residue',
    );
  });

  test('非終端かつ生存実行なし（stale）は cancel される', async () => {
    findManyMock.mockResolvedValue([{ id: 22, taskId: 620, themeId: null }]);
    resolveTaskWorkflowStateMock.mockResolvedValue({
      status: 'in-progress',
      workflowStatus: 'in_progress',
    });
    hasLiveExecutionMock.mockResolvedValue(false);

    const released = await sweepStaleRunningItems(NOW);

    expect(released).toBe(1);
    expect(notifyStallReleasedMock).toHaveBeenCalledWith(
      null,
      620,
      1,
      'stale_running_no_live_execution',
    );
  });

  test('非終端かつ生存実行あり（本当に長いフェーズ）は cancel しない — 二重起動回帰ガード', async () => {
    findManyMock.mockResolvedValue([{ id: 23, taskId: 621, themeId: 2 }]);
    resolveTaskWorkflowStateMock.mockResolvedValue({
      status: 'in-progress',
      workflowStatus: 'in_progress',
    });
    hasLiveExecutionMock.mockResolvedValue(true);

    const released = await sweepStaleRunningItems(NOW);

    expect(released).toBe(0);
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(notifyStallReleasedMock).not.toHaveBeenCalled();
  });

  test('a lost CAS race (count:0) is not counted and not notified', async () => {
    findManyMock.mockResolvedValue([{ id: 24, taskId: 622, themeId: 1 }]);
    resolveTaskWorkflowStateMock.mockResolvedValue({ status: 'done', workflowStatus: null });
    updateManyMock.mockResolvedValue({ count: 0 });

    const released = await sweepStaleRunningItems(NOW);

    expect(released).toBe(0);
    expect(notifyStallReleasedMock).not.toHaveBeenCalled();
  });
});

describe('detectQueueStarvation', () => {
  /** running=0 / queued>0 の観測をセットする。 */
  function primeStarvedCounts(queued = 1): void {
    countMock.mockImplementation(((args: { where: { status: string } }) =>
      Promise.resolve(args.where.status === 'running' ? 0 : queued)) as never);
  }

  test('running>0 なら発火せずトラッカーをリセットする', async () => {
    countMock.mockImplementation(((args: { where: { status: string } }) =>
      Promise.resolve(args.where.status === 'running' ? 1 : 5)) as never);

    expect(await detectQueueStarvation(NOW)).toBe(0);

    // 直後に飢餓状態を観測しても「初回」として扱われる（トラッカーはnull）。
    primeStarvedCounts();
    expect(await detectQueueStarvation(NOW + QUEUE_STARVATION_THRESHOLD_MS * 2)).toBe(0);
    expect(startProcessingMock).not.toHaveBeenCalled();
  });

  test('queued=0 なら発火しない', async () => {
    countMock.mockResolvedValue(0);

    expect(await detectQueueStarvation(NOW)).toBe(0);
    expect(startProcessingMock).not.toHaveBeenCalled();
  });

  test('初回観測では発火しない — フェーズ継ぎ目の一瞬の空隙を誤検出しない (task 585 回帰)', async () => {
    primeStarvedCounts();

    expect(await detectQueueStarvation(NOW)).toBe(0);
    expect(startProcessingMock).not.toHaveBeenCalled();
    expect(notifyQueueStarvationMock).not.toHaveBeenCalled();
    expect(logCycleEventMock).not.toHaveBeenCalled();
  });

  test('閾値未満の継続では発火しない', async () => {
    primeStarvedCounts();

    await detectQueueStarvation(NOW);
    expect(await detectQueueStarvation(NOW + QUEUE_STARVATION_THRESHOLD_MS - 1_000)).toBe(0);
    expect(startProcessingMock).not.toHaveBeenCalled();
  });

  test('閾値超過で runner を蹴り、通知とサイクルログを残す（事例1の検出・解除）', async () => {
    primeStarvedCounts(3);
    findFirstMock.mockResolvedValue({ taskId: 617 });

    await detectQueueStarvation(NOW);
    const handled = await detectQueueStarvation(NOW + QUEUE_STARVATION_THRESHOLD_MS + 60_000);

    expect(handled).toBe(1);
    expect(startProcessingMock).toHaveBeenCalledTimes(1);
    expect(notifyQueueStarvationMock).toHaveBeenCalledWith(617, expect.any(Number));
    expect(logCycleEventMock).toHaveBeenCalledWith(
      'queue.starvation_detected',
      expect.objectContaining({ task: 617, ok: false, cause: 'running_zero_queue_nonzero' }),
    );
  });

  test('最古の queued 項目が取得できなくても発火は成立する（taskId=null 通知）', async () => {
    primeStarvedCounts();
    findFirstMock.mockResolvedValue(null);

    await detectQueueStarvation(NOW);
    const handled = await detectQueueStarvation(NOW + QUEUE_STARVATION_THRESHOLD_MS);

    expect(handled).toBe(1);
    expect(notifyQueueStarvationMock).toHaveBeenCalledWith(null, expect.any(Number));
  });

  test('一度 running>0 を挟むと新エピソードとして再度初回から数える', async () => {
    primeStarvedCounts();
    await detectQueueStarvation(NOW); // 初回観測（エピソード1）

    // running>0 → エピソード解消
    countMock.mockImplementation(((args: { where: { status: string } }) =>
      Promise.resolve(args.where.status === 'running' ? 1 : 1)) as never);
    await detectQueueStarvation(NOW + 60_000);

    // 再度飢餓 → 前エピソードの経過時間は引き継がれない
    primeStarvedCounts();
    expect(await detectQueueStarvation(NOW + QUEUE_STARVATION_THRESHOLD_MS * 2)).toBe(0);
    expect(startProcessingMock).not.toHaveBeenCalled();
  });
});
