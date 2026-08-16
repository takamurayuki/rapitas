/**
 * stall-recovery-service テスト
 *
 * オンデマンド停滞スキャン（閾値境界含む）・パスガード・破壊的操作の
 * フラグゲート・各リカバリーアクションの分岐を検証する。
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { resolve } from 'path';

type MockFn = ReturnType<typeof mock>;

const noopLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  fatal: mock(() => {}),
};

mock.module('../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

interface FakePrisma {
  task: { findMany: MockFn; findUnique: MockFn; update: MockFn };
  agentExecution: { findFirst: MockFn; updateMany: MockFn; count: MockFn };
  agentSession: { findMany: MockFn; findFirst: MockFn; update: MockFn };
}

function makePrisma(): FakePrisma {
  return {
    task: {
      findMany: mock(() => Promise.resolve([])),
      findUnique: mock(() => Promise.resolve(null)),
      update: mock(() => Promise.resolve(null)),
    },
    agentExecution: {
      findFirst: mock(() => Promise.resolve(null)),
      updateMany: mock(() => Promise.resolve({ count: 0 })),
      count: mock(() => Promise.resolve(0)),
    },
    agentSession: {
      findMany: mock(() => Promise.resolve([])),
      findFirst: mock(() => Promise.resolve(null)),
      update: mock(() => Promise.resolve(null)),
    },
  };
}

const prismaMock = makePrisma();
const PROJECT_ROOT = resolve('/proj/rapitas');

// NOTE: worktree では generated Prisma client が未リンクのため、実 config/database
// のロード自体を遮断する（detectors → workflow-reconciler-requeue 経由で届く）。
mock.module('../../../config/database', () => ({
  prisma: prismaMock,
  ensureDatabaseConnection: () => Promise.resolve(),
}));

mock.module('../../../config', () => ({
  prisma: prismaMock,
  createLogger: () => noopLogger,
  logger: noopLogger,
  ensureDatabaseConnection: () => Promise.resolve(),
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => 'default',
  getProjectRoot: () => PROJECT_ROOT,
}));

const gatherTaskStateMock = mock(() => Promise.resolve(makeState()));

mock.module('../../../services/workflow/self-incident-evidence', () => ({
  gatherTaskState: gatherTaskStateMock,
  formatIncidentDetail: mock(() => ''),
}));

const handleResumeCompletionMock = mock(() => {});

mock.module('../../../services/agents/orchestrator/resume-completion', () => ({
  handleResumeCompletion: handleResumeCompletionMock,
}));

const enqueueMock = mock(() => Promise.resolve({ id: 1 }));

mock.module('../../../services/workflow/workflow-queue', () => ({
  WorkflowQueueService: {
    getInstance: () => ({ enqueue: enqueueMock }),
  },
  isTaskTerminalForQueue: () => false,
}));

const { scanStalledTasks, recoverStalledTask, resolveGitLockTarget, isDestructiveRecoveryEnabled } =
  await import('./stall-recovery-service');

interface StateShape {
  taskId: number;
  title: string;
  taskUpdatedAtMs: number;
  timeline: unknown[];
  latestTransitionAtMs: number | null;
  windowedCauses: unknown[];
  latestSessionId: number | null;
  latestSessionStatus: string | null;
  latestExecutionId: number | null;
  latestExecutionStatus: string | null;
  hasLiveExecution: boolean;
  hasAnyExecution: boolean;
  hasActiveQueueItem: boolean;
}

function makeState(overrides: Partial<StateShape> = {}): StateShape {
  return {
    taskId: 1,
    title: 'タスク',
    taskUpdatedAtMs: 0,
    timeline: [],
    latestTransitionAtMs: null,
    windowedCauses: [],
    latestSessionId: null,
    latestSessionStatus: null,
    latestExecutionId: null,
    latestExecutionStatus: null,
    hasLiveExecution: false,
    hasAnyExecution: true,
    hasActiveQueueItem: false,
    ...overrides,
  };
}

const NOW = 1_800_000_000_000;
const THRESHOLD_MS = 30 * 60 * 1000;

function candidateRow(id: number, updatedAtMs: number) {
  return {
    id,
    title: `タスク${id}`,
    status: 'in-progress',
    workflowStatus: 'in_progress',
    updatedAt: new Date(updatedAtMs),
  };
}

beforeEach(() => {
  prismaMock.task.findMany.mockReset().mockResolvedValue([]);
  prismaMock.task.findUnique.mockReset().mockResolvedValue(null);
  prismaMock.task.update.mockReset().mockResolvedValue(null);
  prismaMock.agentExecution.findFirst.mockReset().mockResolvedValue(null);
  prismaMock.agentExecution.updateMany.mockReset().mockResolvedValue({ count: 0 });
  prismaMock.agentExecution.count.mockReset().mockResolvedValue(0);
  prismaMock.agentSession.findMany.mockReset().mockResolvedValue([]);
  prismaMock.agentSession.findFirst.mockReset().mockResolvedValue(null);
  prismaMock.agentSession.update.mockReset().mockResolvedValue(null);
  gatherTaskStateMock.mockReset().mockResolvedValue(makeState());
  handleResumeCompletionMock.mockReset();
  enqueueMock.mockReset().mockResolvedValue({ id: 1 });
  delete process.env.RAPITAS_ENABLE_STALL_DESTRUCTIVE_RECOVERY;
});

describe('scanStalledTasks', () => {
  it('停滞なし（候補ゼロ）→ 空配列を返すこと', async () => {
    const result = await scanStalledTasks(NOW, 'standard');
    expect(result.tasks).toEqual([]);
    expect(result.checkedAt).toBe(new Date(NOW).toISOString());
  });

  it('30分0秒停滞したタスク → 停滞として報告すること（境界値・閾値ちょうど）', async () => {
    const staleAt = NOW - THRESHOLD_MS;
    prismaMock.task.findMany.mockResolvedValue([candidateRow(10, staleAt)]);
    gatherTaskStateMock.mockResolvedValue(makeState({ taskId: 10, taskUpdatedAtMs: staleAt }));

    const result = await scanStalledTasks(NOW, 'standard');
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].taskId).toBe(10);
    expect(result.tasks[0].staleMinutes).toBe(30);
    expect(result.tasks[0].suggestedActions.at(-1)).toBe('clear_git_lock');
    expect(result.tasks[0].narration).toContain('30分間停滞');
  });

  it('29分59秒のタスク → 停滞と判定しないこと（境界値・閾値未満）', async () => {
    const freshAt = NOW - (THRESHOLD_MS - 1000);
    prismaMock.task.findMany.mockResolvedValue([candidateRow(11, freshAt)]);
    gatherTaskStateMock.mockResolvedValue(makeState({ taskId: 11, taskUpdatedAtMs: freshAt }));

    const result = await scanStalledTasks(NOW, 'standard');
    expect(result.tasks).toEqual([]);
  });

  it('実行中エージェントがいるタスク → 停滞から除外すること', async () => {
    const staleAt = NOW - THRESHOLD_MS * 2;
    prismaMock.task.findMany.mockResolvedValue([candidateRow(12, staleAt)]);
    gatherTaskStateMock.mockResolvedValue(
      makeState({ taskId: 12, taskUpdatedAtMs: staleAt, hasLiveExecution: true }),
    );

    const result = await scanStalledTasks(NOW, 'standard');
    expect(result.tasks).toEqual([]);
  });

  it('複数タスクが同時停滞 → 全件を報告すること', async () => {
    const staleAt = NOW - THRESHOLD_MS * 3;
    prismaMock.task.findMany.mockResolvedValue([
      candidateRow(20, staleAt),
      candidateRow(21, staleAt),
    ]);
    gatherTaskStateMock.mockImplementation((task: { id: number }) =>
      Promise.resolve(makeState({ taskId: task.id, taskUpdatedAtMs: staleAt })),
    );

    const result = await scanStalledTasks(NOW, 'concise');
    expect(result.tasks.map((t) => t.taskId)).toEqual([20, 21]);
  });

  it('1タスクの証拠収集が失敗しても他のタスクは報告されること', async () => {
    const staleAt = NOW - THRESHOLD_MS * 2;
    prismaMock.task.findMany.mockResolvedValue([
      candidateRow(30, staleAt),
      candidateRow(31, staleAt),
    ]);
    gatherTaskStateMock.mockImplementation((task: { id: number }) =>
      task.id === 30
        ? Promise.reject(new Error('boom'))
        : Promise.resolve(makeState({ taskId: task.id, taskUpdatedAtMs: staleAt })),
    );

    const result = await scanStalledTasks(NOW, 'standard');
    expect(result.tasks.map((t) => t.taskId)).toEqual([31]);
  });
});

describe('resolveGitLockTarget', () => {
  it('プライマリチェックアウトと同一パス → 拒否すること', () => {
    const result = resolveGitLockTarget(PROJECT_ROOT, PROJECT_ROOT);
    expect(result.ok).toBe(false);
  });

  it('プライマリチェックアウトを内包する親パス → 拒否すること', () => {
    const result = resolveGitLockTarget(resolve('/proj'), PROJECT_ROOT);
    expect(result.ok).toBe(false);
  });

  it('worktree配下の正当なパス → index.lock のパスを返すこと', () => {
    const worktree = resolve('/proj/rapitas/.worktrees/task-99');
    const result = resolveGitLockTarget(worktree, PROJECT_ROOT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lockPath).toBe(resolve(worktree, '.git', 'index.lock'));
    }
  });
});

describe('isDestructiveRecoveryEnabled', () => {
  it('未設定/偽値 → false、1/true → true を返すこと', () => {
    expect(isDestructiveRecoveryEnabled({})).toBe(false);
    expect(isDestructiveRecoveryEnabled({ RAPITAS_ENABLE_STALL_DESTRUCTIVE_RECOVERY: '0' })).toBe(
      false,
    );
    expect(isDestructiveRecoveryEnabled({ RAPITAS_ENABLE_STALL_DESTRUCTIVE_RECOVERY: '1' })).toBe(
      true,
    );
    expect(
      isDestructiveRecoveryEnabled({ RAPITAS_ENABLE_STALL_DESTRUCTIVE_RECOVERY: 'true' }),
    ).toBe(true);
  });
});

describe('recoverStalledTask', () => {
  it('clear_git_lock はフラグ既定OFFのとき実行前に拒否し、DBにも触れないこと', async () => {
    const result = await recoverStalledTask(1, 'clear_git_lock');
    expect(result.success).toBe(false);
    expect(result.message).toContain('RAPITAS_ENABLE_STALL_DESTRUCTIVE_RECOVERY');
    expect(prismaMock.agentSession.findFirst).not.toHaveBeenCalled();
  });

  it('clear_git_lock はフラグONでも worktree 不在なら失敗を返すこと', async () => {
    process.env.RAPITAS_ENABLE_STALL_DESTRUCTIVE_RECOVERY = '1';
    const result = await recoverStalledTask(1, 'clear_git_lock');
    expect(result.success).toBe(false);
    expect(result.message).toContain('worktree');
  });

  it('clear_git_lock はプライマリチェックアウトのパスをハード拒否すること', async () => {
    process.env.RAPITAS_ENABLE_STALL_DESTRUCTIVE_RECOVERY = '1';
    prismaMock.agentSession.findFirst.mockResolvedValue({ worktreePath: PROJECT_ROOT });
    const result = await recoverStalledTask(1, 'clear_git_lock');
    expect(result.success).toBe(false);
    expect(result.message).toContain('拒否');
  });

  it('resume は中断済み実行が無ければ失敗を返すこと', async () => {
    const result = await recoverStalledTask(1, 'resume');
    expect(result.success).toBe(false);
    expect(handleResumeCompletionMock).not.toHaveBeenCalled();
  });

  it('resume は中断済み実行があればタスクを in-progress にして再開を開始すること', async () => {
    prismaMock.agentExecution.findFirst.mockResolvedValue({
      id: 77,
      sessionId: 5,
      session: {
        config: {
          id: 9,
          taskId: 1,
          task: {
            id: 1,
            title: 'T',
            description: null,
            theme: { name: 'theme', workingDirectory: 'C:/work/dir' },
          },
        },
      },
    });
    const result = await recoverStalledTask(1, 'resume');
    expect(result.success).toBe(true);
    expect(prismaMock.task.update).toHaveBeenCalled();
    expect(handleResumeCompletionMock).toHaveBeenCalledTimes(1);
  });

  it('resume はテーマに workingDirectory が無ければ失敗を返すこと', async () => {
    prismaMock.agentExecution.findFirst.mockResolvedValue({
      id: 78,
      sessionId: 5,
      session: {
        config: {
          id: 9,
          taskId: 1,
          task: {
            id: 1,
            title: 'T',
            description: null,
            theme: { name: 't', workingDirectory: null },
          },
        },
      },
    });
    const result = await recoverStalledTask(1, 'resume');
    expect(result.success).toBe(false);
    expect(handleResumeCompletionMock).not.toHaveBeenCalled();
  });

  it('interrupt は実行を中断し、生き残り実行の無いセッションを整理し、in-progressタスクをtodoへ戻すこと', async () => {
    prismaMock.agentExecution.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.agentSession.findMany.mockResolvedValue([{ id: 3 }]);
    prismaMock.agentExecution.count.mockResolvedValue(0);
    prismaMock.task.findUnique.mockResolvedValue({ status: 'in-progress' });

    const result = await recoverStalledTask(1, 'interrupt');
    expect(result.success).toBe(true);
    expect(prismaMock.agentSession.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.task.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'todo' },
    });
  });

  it('requeue は enqueue 成功で success、既にキュー済みエラーで失敗メッセージを返すこと', async () => {
    const ok = await recoverStalledTask(1, 'requeue');
    expect(ok.success).toBe(true);
    expect(enqueueMock).toHaveBeenCalledWith({ taskId: 1 });

    enqueueMock.mockRejectedValueOnce(new Error('Task 1 is already in the queue (status: queued)'));
    const dup = await recoverStalledTask(1, 'requeue');
    expect(dup.success).toBe(false);
    expect(dup.message).toContain('already in the queue');
  });
});
