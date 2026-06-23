/**
 * agent-session-resolver ユニットテスト
 *
 * 各 resolveXxx 関数の正常系・異常系を検証する。
 * prisma は mock.module でスタブ化し、テスト間でリセットする。
 */
import { describe, test, it, expect, mock, beforeEach } from 'bun:test';
import { ID_EDGES, toNameTuples } from '../../tests/helpers/boundary-values';

// HACK(agent): bun:test の mock.module はプロセスグローバルなため、
// 全エクスポートをミラーしないとバレルが "export not found" をスローする。
const mockFindFirst = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;
const mockFindUnique = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;

mock.module('../../config/database', () => ({
  prisma: {
    agentSession: { findFirst: mockFindFirst, findUnique: mockFindUnique },
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

const {
  resolveLatestFinishedSession,
  resolveSessionWithLatestExecution,
  resolveLatestSessionWorktree,
} = await import('./agent-session-resolver');

beforeEach(() => {
  mockFindFirst.mockReset();
  mockFindFirst.mockResolvedValue(null);
  mockFindUnique.mockReset();
  mockFindUnique.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// resolveLatestFinishedSession
// ---------------------------------------------------------------------------
describe('resolveLatestFinishedSession', () => {
  test('完了セッションが存在する場合 → id を返すこと', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 42 });

    const result = await resolveLatestFinishedSession(10);
    expect(result).toEqual({ id: 42 });
  });

  test('該当セッションがない場合 → null を返すこと', async () => {
    mockFindFirst.mockResolvedValueOnce(null);

    const result = await resolveLatestFinishedSession(99);
    expect(result).toBeNull();
  });

  test('DB エラー時 → null を返すこと', async () => {
    mockFindFirst.mockRejectedValueOnce(new Error('DB error'));

    const result = await resolveLatestFinishedSession(1);
    expect(result).toBeNull();
  });

  test('where 条件に configId と status in [completed,failed,interrupted] が含まれること', async () => {
    await resolveLatestFinishedSession(5);

    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    const callArgs = mockFindFirst.mock.calls[0][0] as {
      where: { configId: number; status: { in: string[] } };
      orderBy: { createdAt: string };
      select: { id: boolean };
    };
    expect(callArgs.where.configId).toBe(5);
    expect(callArgs.where.status.in).toContain('completed');
    expect(callArgs.where.status.in).toContain('failed');
    expect(callArgs.where.status.in).toContain('interrupted');
    expect(callArgs.orderBy.createdAt).toBe('desc');
    expect(callArgs.select.id).toBe(true);
  });

  describe('境界値: configId 0/-1/1 → null を返し where.configId に値が伝播すること', () => {
    it.each(toNameTuples(ID_EDGES))(
      'configId %s → null',
      async (_label, input) => {
        const result = await resolveLatestFinishedSession(input);
        expect(result).toBeNull();

        expect(mockFindFirst).toHaveBeenCalledTimes(1);
        const callArgs = mockFindFirst.mock.calls[0][0] as {
          where: { configId: number };
        };
        expect(callArgs.where.configId).toBe(input);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// resolveSessionWithLatestExecution
// ---------------------------------------------------------------------------
describe('resolveSessionWithLatestExecution', () => {
  test('セッションが存在する場合 → agentExecutions 付きセッションを返すこと', async () => {
    const fakeSession = {
      id: 7,
      status: 'completed',
      branchName: 'feature/test',
      worktreePath: '/worktrees/task-7',
      agentExecutions: [{ id: 100, status: 'completed', createdAt: new Date() }],
    };
    mockFindUnique.mockResolvedValueOnce(fakeSession);

    const result = await resolveSessionWithLatestExecution(7);
    expect(result).toEqual(fakeSession);
  });

  test('セッションが存在しない場合 → null を返すこと', async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    const result = await resolveSessionWithLatestExecution(999);
    expect(result).toBeNull();
  });

  test('DB エラー時 → null を返すこと', async () => {
    mockFindUnique.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await resolveSessionWithLatestExecution(1);
    expect(result).toBeNull();
  });

  test('include に agentExecutions の orderBy と take:1 が含まれること', async () => {
    await resolveSessionWithLatestExecution(8);

    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    const callArgs = mockFindUnique.mock.calls[0][0] as {
      where: { id: number };
      include: { agentExecutions: { orderBy: { createdAt: string }; take: number } };
    };
    expect(callArgs.where.id).toBe(8);
    expect(callArgs.include.agentExecutions.orderBy.createdAt).toBe('desc');
    expect(callArgs.include.agentExecutions.take).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// resolveLatestSessionWorktree
// ---------------------------------------------------------------------------
describe('resolveLatestSessionWorktree', () => {
  test('worktree を持つセッションが存在する場合 → worktreePath と branchName を返すこと', async () => {
    const fakeSession = {
      worktreePath: '/worktrees/task-3-abc123',
      branchName: 'feature/3-implement',
    };
    mockFindFirst.mockResolvedValueOnce(fakeSession);

    const result = await resolveLatestSessionWorktree(3);
    expect(result).toEqual(fakeSession);
  });

  test('worktree セッションが存在しない場合 → null を返すこと', async () => {
    mockFindFirst.mockResolvedValueOnce(null);

    const result = await resolveLatestSessionWorktree(999);
    expect(result).toBeNull();
  });

  test('DB エラー時 → null を返すこと', async () => {
    mockFindFirst.mockRejectedValueOnce(new Error('Query failed'));

    const result = await resolveLatestSessionWorktree(1);
    expect(result).toBeNull();
  });

  test('where に taskId 経由フィルタと worktreePath not null が含まれること', async () => {
    await resolveLatestSessionWorktree(9);

    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    const callArgs = mockFindFirst.mock.calls[0][0] as {
      where: { config: { taskId: number }; worktreePath: { not: null } };
      orderBy: { createdAt: string };
      select: { worktreePath: boolean; branchName: boolean };
    };
    expect(callArgs.where.config.taskId).toBe(9);
    expect(callArgs.where.worktreePath.not).toBeNull();
    expect(callArgs.orderBy.createdAt).toBe('desc');
    expect(callArgs.select.worktreePath).toBe(true);
    expect(callArgs.select.branchName).toBe(true);
  });
});
