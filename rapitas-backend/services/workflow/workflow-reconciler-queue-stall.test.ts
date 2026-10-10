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

const { sweepStaleRunningItems, detectQueueStarvation, resetQueueStarvationTracker } =
  await import('./workflow-reconciler-queue-stall');

const NOW = 1_800_000_000_000;

beforeEach(() => {
  findManyMock.mockReset().mockResolvedValue([]);
  taskFindManyMock.mockReset().mockResolvedValue([]);
  updateManyMock.mockReset().mockResolvedValue({ count: 1 });
  countMock.mockReset().mockResolvedValue(0);
  findFirstMock.mockReset().mockResolvedValue(null);
  resolveTaskWorkflowStateMock.mockReset().mockResolvedValue(null);
  hasLiveExecutionMock.mockReset().mockResolvedValue(false);
  startProcessingMock.mockReset();
  releaseQueueItemMock.mockReset().mockReturnValue(true);
  notifyStallReleasedMock.mockReset().mockResolvedValue(undefined);
  notifyQueueStarvationMock.mockReset().mockResolvedValue(undefined);
  notifyQueueStalledRunnerAliveMock.mockReset().mockResolvedValue(undefined);
  logCycleEventMock.mockReset();
  resetQueueStarvationTracker();
});

describe('sweepStaleRunningItems — 実行しえないタスクの残骸 (task 1105)', () => {
  /** Route the two queue-item queries by their where clause. */
  function routeFindMany(
    stale: { id: number; taskId: number; themeId: number | null }[],
    residue: { id: number; taskId: number; themeId: number | null }[],
  ): void {
    findManyMock.mockImplementation((args: unknown) => {
      const where = (args as { where?: { taskId?: { in?: number[] } } })?.where;
      return Promise.resolve(where?.taskId?.in ? residue : stale);
    });
  }

  test('halt 済みタスクの running 残骸は 40 分待たずに解放される', async () => {
    routeFindMany([], [{ id: 4101, taskId: 1105, themeId: 1 }]);
    taskFindManyMock.mockResolvedValue([{ id: 1105 }]);
    resolveTaskWorkflowStateMock.mockResolvedValue({
      status: 'blocked',
      workflowStatus: 'in_progress',
    });

    expect(await sweepStaleRunningItems(NOW)).toBe(1);
    const call = updateManyMock.mock.calls[0]?.[0] as { where: { id: number; status: string } };
    expect(call.where).toEqual({ id: 4101, status: 'running' });
    expect(logCycleEventMock).toHaveBeenCalledWith(
      'task.stall_released',
      expect.objectContaining({ task: 1105, cause: 'unrunnable_task_running_residue' }),
    );
  });

  test('生存中のエージェントがいる限り解放しない（二重起動の防止は維持）', async () => {
    routeFindMany([], [{ id: 4101, taskId: 1105, themeId: 1 }]);
    taskFindManyMock.mockResolvedValue([{ id: 1105 }]);
    resolveTaskWorkflowStateMock.mockResolvedValue({
      status: 'blocked',
      workflowStatus: 'in_progress',
    });
    hasLiveExecutionMock.mockResolvedValue(true);

    expect(await sweepStaleRunningItems(NOW)).toBe(0);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  test('halt / blocked のタスクが無ければ残骸の照会自体を行わない', async () => {
    taskFindManyMock.mockResolvedValue([]);
    await sweepStaleRunningItems(NOW);
    const residueQuery = findManyMock.mock.calls.find(
      (c) => (c[0] as { where?: { taskId?: unknown } })?.where?.taskId !== undefined,
    );
    expect(residueQuery).toBeUndefined();
  });

  test('照会条件は haltReason 付き または blocked', async () => {
    await sweepStaleRunningItems(NOW);
    expect(taskFindManyMock.mock.calls[0][0]).toEqual({
      where: { OR: [{ haltReason: { not: null } }, { status: 'blocked' }] },
      select: { id: true },
    });
  });
});

describe('sweepStaleRunningItems', () => {
  test('no stale candidates short-circuits without task lookups', async () => {
    const released = await sweepStaleRunningItems(NOW);

    expect(released).toBe(0);
    expect(resolveTaskWorkflowStateMock).not.toHaveBeenCalled();
    const where = (
      findManyMock.mock.calls[0]?.[0] as { where: { status: string; startedAt: { lt: Date } } }
    ).where;
    expect(where.status).toBe('running');
    expect(where.startedAt.lt.getTime()).toBe(NOW - RUNNING_ITEM_STALE_MS);
  });

  test('cancelling a stale running item also releases the runner activeExecutions slot (task 1165)', async () => {
    findManyMock.mockResolvedValue([{ id: 4168, taskId: 1159, themeId: 1 }]);
    resolveTaskWorkflowStateMock.mockResolvedValue({ status: 'done', workflowStatus: null });

    expect(await sweepStaleRunningItems(NOW)).toBe(1);

    expect(releaseQueueItemMock).toHaveBeenCalledWith(4168);
  });

  test('a lost CAS (count 0) does not release the runner slot (task 1165)', async () => {
    findManyMock.mockResolvedValue([{ id: 4168, taskId: 1159, themeId: 1 }]);
    resolveTaskWorkflowStateMock.mockResolvedValue({ status: 'done', workflowStatus: null });
    updateManyMock.mockResolvedValue({ count: 0 });

    expect(await sweepStaleRunningItems(NOW)).toBe(0);

    expect(releaseQueueItemMock).not.toHaveBeenCalled();
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

  // task 1106(2026-09-27): フェーズ継ぎ目で item が queued に戻る間もエージェントは
  // 走っている。item の status だけを見ると running=0 / queued>0 に見えて、健全な
  // ワークフローに飢餓アラートが出ていた。
  test('queued 項目のタスクにエージェントが生存していれば発火しない', async () => {
    primeStarvedCounts(2);
    findManyMock.mockResolvedValue([{ id: 0, taskId: 1106, themeId: 1 }]);
    taskFindManyMock.mockResolvedValue([
      { id: 1106, status: 'in-progress', workflowStatus: 'in_progress', haltReason: null },
    ] as never);
    hasLiveExecutionMock.mockResolvedValue(true);

    await detectQueueStarvation(NOW);
    expect(await detectQueueStarvation(NOW + QUEUE_STARVATION_THRESHOLD_MS * 2)).toBe(0);
    expect(startProcessingMock).not.toHaveBeenCalled();
    expect(notifyQueueStarvationMock).not.toHaveBeenCalled();
  });

  test('生存エージェントが居なければ従来どおり発火する', async () => {
    primeStarvedCounts(2);
    findManyMock.mockResolvedValue([{ id: 0, taskId: 1106, themeId: 1 }]);
    taskFindManyMock.mockResolvedValue([
      { id: 1106, status: 'todo', workflowStatus: 'draft', haltReason: null },
    ] as never);
    hasLiveExecutionMock.mockResolvedValue(false);
    findFirstMock.mockResolvedValue({ taskId: 1106 });

    await detectQueueStarvation(NOW);
    expect(await detectQueueStarvation(NOW + QUEUE_STARVATION_THRESHOLD_MS + 1_000)).toBe(1);
  });

  // 2026-09-27: 本日 7 回出た飢餓アラートは、待機中の項目がすべて halt / blocked /
  // 質問待ち / マージ待ちで「ランナーが発行を拒否する相手」だった。飢餓とは
  // 「発行できる仕事が待っているのに何も走っていない」ことを指す。
  test.each([
    [
      'halt 済み',
      { status: 'todo', workflowStatus: 'in_progress', haltReason: 'budget_cost_exceeded' },
    ],
    ['blocked', { status: 'blocked', workflowStatus: 'in_progress', haltReason: null }],
    ['質問待ち', { status: 'todo', workflowStatus: 'awaiting_question', haltReason: null }],
    [
      'マージ待ち(verify_done)',
      { status: 'in-progress', workflowStatus: 'verify_done', haltReason: null },
    ],
  ])('待機中の項目が %s だけなら発火しない', async (_label, taskState) => {
    primeStarvedCounts(1);
    findManyMock.mockResolvedValue([{ id: 0, taskId: 1105, themeId: 1 }]);
    taskFindManyMock.mockResolvedValue([{ id: 1105, ...taskState }] as never);
    hasLiveExecutionMock.mockResolvedValue(false);

    await detectQueueStarvation(NOW);
    expect(await detectQueueStarvation(NOW + QUEUE_STARVATION_THRESHOLD_MS * 2)).toBe(0);
    expect(startProcessingMock).not.toHaveBeenCalled();
  });

  test('タスク状態が読めないときは従来どおり発火する(情報不足で黙らせない)', async () => {
    primeStarvedCounts(1);
    findManyMock.mockResolvedValue([{ id: 0, taskId: 1105, themeId: 1 }]);
    taskFindManyMock.mockRejectedValue(new Error('db down') as never);
    hasLiveExecutionMock.mockResolvedValue(false);
    findFirstMock.mockResolvedValue({ taskId: 1105 });

    await detectQueueStarvation(NOW);
    expect(await detectQueueStarvation(NOW + QUEUE_STARVATION_THRESHOLD_MS + 1_000)).toBe(1);
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

describe('detectQueueStarvation — ランナー稼働中は「再起動した」と報告しない', () => {
  // 実測 2026-08-28: [reconciler] Queue starvation detected 78件 と
  // [WorkflowRunner] Already running 78件 が完全に一致していた。ランナーは
  // 動いており kick は毎回 no-op なのに、episode が解除されないため毎サイクル
  // 「再起動した」と報告し続けていた。
  function primeStarvedCounts(queued = 1): void {
    countMock.mockImplementation(((args: { where: { status: string } }) =>
      Promise.resolve(args.where.status === 'running' ? 0 : queued)) as never);
  }

  test('稼働中でも発火数1を返し、kickせず専用の通知を出す（2026-09-17: silent gap fix）', async () => {
    isProcessingMock.mockReturnValue(true);
    primeStarvedCounts(3);
    findFirstMock.mockResolvedValue({ taskId: 905 });
    await detectQueueStarvation(NOW); // 初回観測でトラッカーを起動
    const fired = await detectQueueStarvation(NOW + QUEUE_STARVATION_THRESHOLD_MS * 2);

    expect(fired).toBe(1);
    // The kick itself is still a no-op — startProcessing() is called (it is
    // idempotent) but nothing about the queue state is fixed by this pass.
    expect(notifyQueueStarvationMock).not.toHaveBeenCalled();
    expect(notifyQueueStalledRunnerAliveMock).toHaveBeenCalledWith(905, expect.any(Number));
    expect(logCycleEventMock).toHaveBeenCalledWith(
      'queue.starvation_detected',
      expect.objectContaining({ task: 905, ok: false, cause: 'runner_alive_not_dispatching' }),
    );
  });

  test('同一エピソード中に何度呼ばれても記録・通知は1回だけ（ログ連打の再発防止は維持）', async () => {
    isProcessingMock.mockReturnValue(true);
    primeStarvedCounts();
    await detectQueueStarvation(NOW);
    for (let i = 0; i < 5; i++) {
      await detectQueueStarvation(NOW + QUEUE_STARVATION_THRESHOLD_MS * (2 + i));
    }
    expect(notifyQueueStarvationMock).not.toHaveBeenCalled();
    expect(notifyQueueStalledRunnerAliveMock).toHaveBeenCalledTimes(1);
    expect(logCycleEventMock).toHaveBeenCalledTimes(1);
  });

  test('停止中なら従来どおり kick して通知する', async () => {
    isProcessingMock.mockReturnValue(false);
    primeStarvedCounts();
    await detectQueueStarvation(NOW);
    const fired = await detectQueueStarvation(NOW + QUEUE_STARVATION_THRESHOLD_MS * 2);

    expect(fired).toBe(1);
    expect(startProcessingMock).toHaveBeenCalled();
    expect(notifyQueueStarvationMock).toHaveBeenCalled();
  });
});
