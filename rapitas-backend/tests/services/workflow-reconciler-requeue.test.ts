/**
 * workflow-reconciler-requeue テスト
 *
 * healUndispatchableTodo: todo×verify_done（遷移表に無い死に状態）を draft へ
 * リセット（1回限り）、todo×completed を done へ確定。live実行中はスキップ。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  task: {
    findMany: mock(() => Promise.resolve([] as unknown[])),
    update: mock(() => Promise.resolve({})),
    // The resume decision (task 1563) reads the task row, its history and its PR; empty = nothing to keep.
    // Also feeds the stop guard (status / themeId); nothing to keep (no worktree, no PR).
    findUnique: mock(() =>
      Promise.resolve({ status: 'blocked', themeId: 1, workingDirectory: null, githubPrId: null }),
    ),
  },
  gitHubPullRequest: { findFirst: mock(() => Promise.resolve(null as unknown)) },
  agentExecution: { findFirst: mock(() => Promise.resolve(null as unknown)) },
  workflowTransition: {
    count: mock(() => Promise.resolve(0)),
    // The blocked entry carries an allow-listed cause; no stop transition exists.
    findFirst: mock((a?: { where?: { toStatus?: unknown } }) =>
      Promise.resolve(
        a?.where?.toStatus === 'blocked'
          ? { fromStatus: 'draft', createdAt: new Date(0), cause: 'auto_run_hang_backstop' }
          : (null as unknown),
      ),
    ),
  },
  themeAutoRun: {
    findMany: mock(() => Promise.resolve([] as unknown[])),
    findFirst: mock(() => Promise.resolve({ enabled: true, status: 'running' })),
  },
  userSettings: { findFirst: mock(() => Promise.resolve(null as unknown)) },
  activityLog: { findFirst: mock(() => Promise.resolve(null as unknown)) },
};
const recordTransition = mock(() => Promise.resolve());

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
mock.module('../../services/workflow/transition-recorder', () => ({ recordTransition }));

const { healUndispatchableTodo, requeueBlockedTasks } =
  await import('../../services/workflow/workflow-reconciler-requeue');

const NOW = 1_800_000_000_000;

describe('healUndispatchableTodo', () => {
  beforeEach(() => {
    mockPrisma.task.findMany.mockReset().mockResolvedValue([]);
    mockPrisma.task.update.mockReset().mockResolvedValue({});
    mockPrisma.agentExecution.findFirst.mockReset().mockResolvedValue(null);
    mockPrisma.workflowTransition.count.mockReset().mockResolvedValue(0);
    recordTransition.mockReset().mockResolvedValue(undefined);
  });

  test('todo×verify_done を draft へリセットし遷移を記録すること', async () => {
    // 1st findMany = stranded (verify_done), 2nd = completed desync
    mockPrisma.task.findMany.mockResolvedValueOnce([{ id: 8 }]).mockResolvedValueOnce([]);

    const healed = await healUndispatchableTodo(NOW);

    expect(healed).toBe(1);
    const tu = mockPrisma.task.update.mock.calls[0][0] as {
      data: { workflowStatus: string };
    };
    expect(tu.data.workflowStatus).toBe('draft');
    const rt = recordTransition.mock.calls[0][0] as { cause: string; fromStatus: string };
    expect(rt.cause).toBe('reconciler_reset_undispatchable');
    expect(rt.fromStatus).toBe('verify_done');
  });

  test('リセットは1タスク1回限り（2回目はスキップ）', async () => {
    mockPrisma.task.findMany.mockResolvedValueOnce([{ id: 8 }]).mockResolvedValueOnce([]);
    mockPrisma.workflowTransition.count.mockResolvedValue(1); // already reset once

    const healed = await healUndispatchableTodo(NOW);

    expect(healed).toBe(0);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  test('live実行が居るタスクはスキップ（実行中の完了処理と競合しない）', async () => {
    mockPrisma.task.findMany.mockResolvedValueOnce([{ id: 8 }]).mockResolvedValueOnce([]);
    mockPrisma.agentExecution.findFirst.mockResolvedValue({ id: 1 });

    const healed = await healUndispatchableTodo(NOW);

    expect(healed).toBe(0);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  test('todo×completed は done へ確定すること', async () => {
    mockPrisma.task.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 12, completedAt: null }]);

    const healed = await healUndispatchableTodo(NOW);

    expect(healed).toBe(1);
    const tu = mockPrisma.task.update.mock.calls[0][0] as {
      data: { status: string; completedAt: Date };
    };
    expect(tu.data.status).toBe('done');
    expect(tu.data.completedAt).toBeInstanceOf(Date);
  });
});

describe('requeueBlockedTasks — 未着地PRの手動是正保留 (task873/948)', () => {
  beforeEach(() => {
    mockPrisma.task.findMany.mockReset().mockResolvedValue([]);
    mockPrisma.task.update.mockReset().mockResolvedValue({});
    mockPrisma.agentExecution.findFirst.mockReset().mockResolvedValue(null);
    mockPrisma.workflowTransition.count.mockReset().mockResolvedValue(0);
    mockPrisma.themeAutoRun.findMany.mockReset().mockResolvedValue([{ themeId: 1 }]);
    mockPrisma.userSettings.findFirst.mockReset().mockResolvedValue(null);
    mockPrisma.activityLog.findFirst.mockReset().mockResolvedValue(null);
    recordTransition.mockReset().mockResolvedValue(undefined);
  });

  test('manual_correction_pr_not_landed 遷移あり → blocked_auto_retry でリセットされない', async () => {
    mockPrisma.task.findMany.mockResolvedValue([{ id: 873, workflowStatus: 'blocked' }]);
    mockPrisma.workflowTransition.count.mockImplementation((args: unknown) => {
      const where = (args as { where: { cause: string } }).where;
      return Promise.resolve(where.cause === 'manual_correction_pr_not_landed' ? 1 : 0);
    });

    const retried = await requeueBlockedTasks(NOW);

    expect(retried).toBe(0);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalled();
  });

  test('manual_correction_pr_not_landed が task_retried より前 → ウィンドウ解除され通常どおりリセットされる', async () => {
    mockPrisma.task.findMany.mockResolvedValue([{ id: 873, workflowStatus: 'blocked' }]);
    const retriedAt = new Date(NOW - 60_000);
    mockPrisma.activityLog.findFirst.mockResolvedValue({ createdAt: retriedAt });
    mockPrisma.workflowTransition.count.mockImplementation((args: unknown) => {
      const where = (args as { where: { cause: string; createdAt?: { gt: Date } } }).where;
      // The correction was recorded BEFORE the manual retry: a windowed query sees 0.
      if (where.cause === 'manual_correction_pr_not_landed')
        return Promise.resolve(where.createdAt?.gt ? 0 : 1);
      return Promise.resolve(0);
    });

    const retried = await requeueBlockedTasks(NOW);

    expect(retried).toBe(1);
    expect(mockPrisma.task.update).toHaveBeenCalledTimes(1);
    const rt = recordTransition.mock.calls[0][0] as { cause: string };
    expect(rt.cause).toBe('blocked_auto_retry');
  });
});

describe('requeueBlockedTasks — 停止保護と cause 許可（呼び出し元経由, task 1563）', () => {
  const blockedEntry = (cause: string | null) => (a?: { where?: { toStatus?: unknown } }) =>
    Promise.resolve(
      a?.where?.toStatus === 'blocked' && cause
        ? { fromStatus: 'draft', createdAt: new Date(0), cause }
        : null,
    );

  beforeEach(() => {
    mockPrisma.task.findMany.mockReset().mockResolvedValue([{ id: 873, workflowStatus: 'draft' }]);
    mockPrisma.task.update.mockReset().mockResolvedValue({});
    mockPrisma.agentExecution.findFirst.mockReset().mockResolvedValue(null);
    mockPrisma.workflowTransition.count.mockReset().mockResolvedValue(0);
    mockPrisma.workflowTransition.findFirst
      .mockReset()
      .mockImplementation(blockedEntry('auto_run_hang_backstop') as never);
    mockPrisma.themeAutoRun.findMany.mockReset().mockResolvedValue([{ themeId: 1 }]);
    mockPrisma.themeAutoRun.findFirst
      .mockReset()
      .mockResolvedValue({ enabled: true, status: 'running' });
    mockPrisma.userSettings.findFirst.mockReset().mockResolvedValue(null);
    mockPrisma.activityLog.findFirst.mockReset().mockResolvedValue(null);
    recordTransition.mockReset().mockResolvedValue(undefined);
  });

  const expectNothingWritten = () => {
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalled();
  };

  test('許可 cause（auto_run_hang_backstop）で停止されていなければ再開される', async () => {
    await requeueBlockedTasks(NOW);

    expect(mockPrisma.task.update).toHaveBeenCalledTimes(1);
    const rt = recordTransition.mock.calls[0][0] as { cause: string };
    expect(rt.cause).toBe('blocked_auto_retry');
  });

  test('テーマが停止中（running でない）なら何も書かない', async () => {
    mockPrisma.themeAutoRun.findFirst.mockResolvedValue({ enabled: true, status: 'paused_user' });

    await requeueBlockedTasks(NOW);

    expectNothingWritten();
  });

  test('最新の実行が取消されていれば何も書かない', async () => {
    mockPrisma.agentExecution.findFirst.mockResolvedValue({
      id: 1,
      status: 'cancelled',
      startedAt: new Date(NOW),
    });

    await requeueBlockedTasks(NOW);

    expectNothingWritten();
  });

  test.each(['verify_no_convergence', 'auto_run_stop_revert', 'some_future_unknown_cause'])(
    '不許可・未知の cause（%s）なら何も書かない',
    async (cause) => {
      mockPrisma.workflowTransition.findFirst.mockImplementation(blockedEntry(cause) as never);

      await requeueBlockedTasks(NOW);

      expectNothingWritten();
    },
  );

  test('blocked に入った遷移を読めない（cause 不明）なら何も書かない', async () => {
    mockPrisma.workflowTransition.findFirst.mockImplementation(blockedEntry(null) as never);

    await requeueBlockedTasks(NOW);

    expectNothingWritten();
  });

  test('停止ガードの読取が失敗しても何も書かない（fail closed）', async () => {
    mockPrisma.themeAutoRun.findFirst.mockRejectedValue(new Error('db unavailable'));

    await requeueBlockedTasks(NOW);

    expectNothingWritten();
  });
});
