/**
 * task-worktree-cleanup ユニットテスト
 *
 * cleanUpTaskWorktrees の baseDir 解決・共有worktreeのグルーピング・
 * 失敗時の継続を検証する。
 *
 * このモジュールにはテストが1件も無く、completed-task-cleanup が同じループの
 * 2つ目の実装を持っていた（#825 のグルーピング修正はそちら側にだけ入っていた）。
 * #1330 のレビューでその重複を解消し、グルーピングをこちらへ移したため、
 * 検証もここへ移している。
 *
 * prisma / getProjectRoot / removeWorktree はモジュール直importなので
 * mock.module が必須。bun:test の mock.module はプロセスグローバルであり、
 * 各モジュールの実エクスポートを全てミラーする必要がある。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
};

const taskFindUnique = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;
const agentSessionFindMany = mock(() => Promise.resolve([])) as ReturnType<typeof mock>;
const agentSessionUpdateMany = mock(() => Promise.resolve({ count: 0 })) as ReturnType<typeof mock>;

const fakePrisma = {
  task: { findUnique: taskFindUnique },
  agentSession: { findMany: agentSessionFindMany, updateMany: agentSessionUpdateMany },
};

mock.module('../../config/database', () => ({
  prisma: fakePrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));

mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const getProjectRootMock = mock(() => '/tmp/project-root') as ReturnType<typeof mock>;

mock.module('../../config', () => ({
  prisma: fakePrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
  logger: noopLogger,
  createLogger: () => noopLogger,
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => ({ mode: 'insensitive' }),
  getProjectRoot: getProjectRootMock,
}));

const removeWorktreeMock = mock(() => Promise.resolve(true)) as ReturnType<typeof mock>;

mock.module('../agents/orchestrator/git-operations/worktree/worktree-ops', () => ({
  removeWorktree: removeWorktreeMock,
}));

const { cleanUpTaskWorktrees } = await import('./task-worktree-cleanup');

beforeEach(() => {
  taskFindUnique.mockReset();
  taskFindUnique.mockResolvedValue({ workingDirectory: null });
  agentSessionFindMany.mockReset();
  agentSessionFindMany.mockResolvedValue([]);
  agentSessionUpdateMany.mockReset();
  agentSessionUpdateMany.mockResolvedValue({ count: 0 });
  getProjectRootMock.mockReset();
  getProjectRootMock.mockReturnValue('/tmp/project-root');
  removeWorktreeMock.mockReset();
  removeWorktreeMock.mockResolvedValue(true);
});

describe('cleanUpTaskWorktrees — baseDir の解決', () => {
  test('task.workingDirectory がある場合 → それが baseDir になること', async () => {
    taskFindUnique.mockResolvedValueOnce({ workingDirectory: '/projects/task-20' });
    agentSessionFindMany.mockResolvedValueOnce([
      { id: 1, worktreePath: '/projects/task-20/.worktrees/a' },
    ]);

    await cleanUpTaskWorktrees(20);

    expect(removeWorktreeMock).toHaveBeenCalledWith(
      '/projects/task-20',
      '/projects/task-20/.worktrees/a',
    );
    expect(agentSessionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [1] } },
      data: { worktreePath: null },
    });
  });

  test('task.workingDirectory が無く theme.workingDirectory がある場合 → theme 側が使われること', async () => {
    taskFindUnique.mockResolvedValueOnce({
      workingDirectory: null,
      theme: { workingDirectory: '/projects/theme-dir' },
    });
    agentSessionFindMany.mockResolvedValueOnce([
      { id: 5, worktreePath: '/projects/theme-dir/.worktrees/a' },
    ]);

    await cleanUpTaskWorktrees(25);

    expect(removeWorktreeMock).toHaveBeenCalledWith(
      '/projects/theme-dir',
      '/projects/theme-dir/.worktrees/a',
    );
  });

  test('どちらも無い場合 → getProjectRoot が baseDir になること', async () => {
    taskFindUnique.mockResolvedValueOnce({ workingDirectory: null });
    agentSessionFindMany.mockResolvedValueOnce([{ id: 2, worktreePath: '/wt/b' }]);

    await cleanUpTaskWorktrees(21);

    expect(removeWorktreeMock).toHaveBeenCalledWith('/tmp/project-root', '/wt/b');
  });

  test('タスクが存在しない場合 → セッションを引かずに何もしないこと', async () => {
    taskFindUnique.mockResolvedValueOnce(null);

    await cleanUpTaskWorktrees(999);

    expect(agentSessionFindMany).not.toHaveBeenCalled();
    expect(removeWorktreeMock).not.toHaveBeenCalled();
  });
});

// #825: 複数セッションが1つの worktree を共有する（リトライ・自己修復の差し戻し）。
// 1セッションずつ removeWorktree を呼ぶと、2回目以降は必ず「失敗」に見える。
describe('cleanUpTaskWorktrees — 共有 worktree のグルーピング (#825)', () => {
  test('同一 worktreePath のセッションは1回だけ除去し、全IDをまとめてクリアすること', async () => {
    taskFindUnique.mockResolvedValueOnce({ workingDirectory: '/projects/task-26' });
    agentSessionFindMany.mockResolvedValueOnce([
      { id: 10, worktreePath: '/projects/task-26/.worktrees/shared' },
      { id: 11, worktreePath: '/projects/task-26/.worktrees/shared' },
      { id: 12, worktreePath: '/projects/task-26/.worktrees/shared' },
    ]);

    await cleanUpTaskWorktrees(26);

    expect(removeWorktreeMock).toHaveBeenCalledTimes(1);
    expect(agentSessionUpdateMany).toHaveBeenCalledTimes(1);
    expect(agentSessionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [10, 11, 12] } },
      data: { worktreePath: null },
    });
  });

  test('異なる worktreePath は別々に除去されること', async () => {
    taskFindUnique.mockResolvedValueOnce({ workingDirectory: '/p' });
    agentSessionFindMany.mockResolvedValueOnce([
      { id: 1, worktreePath: '/p/.worktrees/a' },
      { id: 2, worktreePath: '/p/.worktrees/b' },
    ]);

    await cleanUpTaskWorktrees(27);

    expect(removeWorktreeMock).toHaveBeenCalledTimes(2);
    expect(agentSessionUpdateMany).toHaveBeenCalledTimes(2);
  });
});

describe('cleanUpTaskWorktrees — 失敗しても投げないこと', () => {
  test('worktreePath が null のセッションはスキップすること', async () => {
    agentSessionFindMany.mockResolvedValueOnce([{ id: 3, worktreePath: null }]);

    await cleanUpTaskWorktrees(22);

    expect(removeWorktreeMock).not.toHaveBeenCalled();
    expect(agentSessionUpdateMany).not.toHaveBeenCalled();
  });

  test('removeWorktree が false を返した場合 → worktreePath はクリアしないこと', async () => {
    // 消えていない worktree のパスを消すと、次回の掃除が対象を見つけられない。
    agentSessionFindMany.mockResolvedValueOnce([{ id: 5, worktreePath: '/wt/a' }]);
    removeWorktreeMock.mockResolvedValueOnce(false);

    await cleanUpTaskWorktrees(25);

    expect(agentSessionUpdateMany).not.toHaveBeenCalled();
  });

  test('removeWorktree が例外を投げても、他の worktree の処理は続くこと', async () => {
    agentSessionFindMany.mockResolvedValueOnce([
      { id: 4, worktreePath: '/wt/c' },
      { id: 6, worktreePath: '/wt/d' },
    ]);
    removeWorktreeMock.mockRejectedValueOnce(new Error('git error'));

    await cleanUpTaskWorktrees(23);

    expect(removeWorktreeMock).toHaveBeenCalledTimes(2);
    expect(agentSessionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [6] } },
      data: { worktreePath: null },
    });
  });

  test('task.findUnique が例外を投げても投げ返さないこと', async () => {
    // 呼び出し元は削除の直前にいる。ディレクトリが片付かないことを理由に
    // 削除を止めても誰の得にもならない。
    taskFindUnique.mockRejectedValueOnce(new Error('DB error'));

    await cleanUpTaskWorktrees(24);

    expect(removeWorktreeMock).not.toHaveBeenCalled();
  });
});
