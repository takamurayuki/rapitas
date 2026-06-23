/**
 * auth-session-resolver ユニットテスト
 *
 * resolveSessionByToken の正常系・異常系を検証する。
 * prisma は mock.module でスタブ化し、テスト間でリセットする。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// HACK(agent): bun:test の mock.module はプロセスグローバルなため、
// 全エクスポートをミラーしないとバレルが "export not found" をスローする。
const mockUserSessionFindFirst = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;

mock.module('../../config/database', () => ({
  prisma: {
    userSession: { findFirst: mockUserSessionFindFirst },
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

const { resolveSessionByToken } = await import('./auth-session-resolver');

beforeEach(() => {
  mockUserSessionFindFirst.mockReset();
  mockUserSessionFindFirst.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// resolveSessionByToken
// ---------------------------------------------------------------------------
describe('resolveSessionByToken', () => {
  test('有効なセッションが存在する場合 → セッションとユーザーを返すこと', async () => {
    const fakeSession = {
      id: 1,
      sessionToken: 'valid-token-abc',
      userId: 42,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
      user: {
        id: 42,
        username: 'testuser',
        email: 'test@example.com',
        role: 'user',
        lastLoginAt: new Date(),
      },
    };
    mockUserSessionFindFirst.mockResolvedValueOnce(fakeSession);

    const result = await resolveSessionByToken('valid-token-abc');
    expect(result).toEqual(fakeSession);
  });

  /** null-return パスのパラメータテーブル（トークン文字列入力 + 空文字/空白境界値） */
  type TokenNullReturnCase = {
    label: string;
    token: string;
    setup: (m: ReturnType<typeof mock>) => void;
  };

  const tokenNullReturnCases: TokenNullReturnCase[] = [
    {
      label: 'not found (token not in DB)',
      token: 'expired-or-missing-token',
      setup: (m) => m.mockResolvedValueOnce(null),
    },
    {
      label: 'DB error',
      token: 'any-token',
      setup: (m) => m.mockRejectedValueOnce(new Error('DB connection lost')),
    },
    {
      label: 'empty string token (boundary)',
      token: '',
      setup: (m) => m.mockResolvedValueOnce(null),
    },
    {
      label: 'whitespace-only token (boundary)',
      token: ' ',
      setup: (m) => m.mockResolvedValueOnce(null),
    },
  ];

  test.each(tokenNullReturnCases)('$label → null', async ({ token, setup }) => {
    setup(mockUserSessionFindFirst);
    const result = await resolveSessionByToken(token);
    expect(result).toBeNull();
  });

  // NOTE: expiresAt.gt は Date 相対演算を含むためパラメータ化せず個別 test() で維持する。
  test('クエリ条件が sessionToken + expiresAt gt now + include user で呼ばれること', async () => {
    const before = new Date();
    await resolveSessionByToken('check-token');
    const after = new Date();

    expect(mockUserSessionFindFirst).toHaveBeenCalledTimes(1);
    const callArgs = mockUserSessionFindFirst.mock.calls[0][0] as {
      where: { sessionToken: string; expiresAt: { gt: Date } };
      include: { user: boolean };
    };
    expect(callArgs.where.sessionToken).toBe('check-token');
    expect(callArgs.include).toEqual({ user: true });
    // expiresAt.gt は "now" 相当 — テスト実行時刻の前後に収まること
    const gt = callArgs.where.expiresAt.gt;
    expect(gt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 5);
    expect(gt.getTime()).toBeLessThanOrEqual(after.getTime() + 5);
  });
});
