/**
 * agent-session-resolver ユニットテスト
 *
 * resolveLatestWorktreeSession の正常系・異常系を検証する。
 * prisma は mock.module でスタブ化し、テスト間でリセットする。
 */
import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';

// HACK(agent): bun:test の mock.module はプロセスグローバルなため、
// 全エクスポートをミラーしないとバレルが "export not found" をスローする。
const mockAgentSessionFindFirst = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;

mock.module('../../config/database', () => ({
  prisma: {
    agentSession: { findFirst: mockAgentSessionFindFirst },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

mock.module('../../config/logger', () => {
  const noopLogger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    fatal: () => {},
  };
  return {
    createLogger: () => noopLogger,
    logger: noopLogger,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

const { resolveLatestWorktreeSession } = await import('./agent-session-resolver');

beforeEach(() => {
  mockAgentSessionFindFirst.mockReset();
  mockAgentSessionFindFirst.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// resolveLatestWorktreeSession
// ---------------------------------------------------------------------------
describe('resolveLatestWorktreeSession', () => {
  test('worktree ありのセッションが存在する場合 → worktreePath と branchName を返すこと', async () => {
    mockAgentSessionFindFirst.mockResolvedValueOnce({
      worktreePath: '/projects/foo/.worktrees/task-1-abc',
      branchName: 'feature/task-1',
    });
    const result = await resolveLatestWorktreeSession(1);
    expect(result).toEqual({
      worktreePath: '/projects/foo/.worktrees/task-1-abc',
      branchName: 'feature/task-1',
    });
  });

  test('branchName が null の場合 → null を含むオブジェクトを返すこと', async () => {
    mockAgentSessionFindFirst.mockResolvedValueOnce({
      worktreePath: '/projects/foo/.worktrees/task-1-abc',
      branchName: null,
    });
    const result = await resolveLatestWorktreeSession(1);
    expect(result).toEqual({
      worktreePath: '/projects/foo/.worktrees/task-1-abc',
      branchName: null,
    });
  });

  test('セッションが存在しない場合 → null を返すこと', async () => {
    mockAgentSessionFindFirst.mockResolvedValueOnce(null);
    const result = await resolveLatestWorktreeSession(1);
    expect(result).toBeNull();
  });

  test('DB が reject した場合 → null を返すこと（.catch により）', async () => {
    mockAgentSessionFindFirst.mockRejectedValueOnce(new Error('DB error'));
    const result = await resolveLatestWorktreeSession(1);
    expect(result).toBeNull();
  });

  test('where 条件（config.taskId + worktreePath not null）と orderBy createdAt desc で呼ばれること', async () => {
    await resolveLatestWorktreeSession(42);
    expect(mockAgentSessionFindFirst).toHaveBeenCalledTimes(1);
    const callArgs = mockAgentSessionFindFirst.mock.calls[0][0] as {
      where: { config: { taskId: number }; worktreePath: { not: null } };
      orderBy: { createdAt: string };
      select: { worktreePath: boolean; branchName: boolean };
    };
    expect(callArgs.where.config.taskId).toBe(42);
    expect(callArgs.where.worktreePath).toEqual({ not: null });
    expect(callArgs.orderBy).toEqual({ createdAt: 'desc' });
    expect(callArgs.select.worktreePath).toBe(true);
    expect(callArgs.select.branchName).toBe(true);
  });
});

// NOTE: afterAll で mock をリストアしてプロセスグローバル mock の他テストへの漏出を防ぐ。
afterAll(() => mock.restore());
