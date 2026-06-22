/**
 * auth-session-resolver ユニットテスト
 *
 * resolveSessionByToken の正常系・異常系を検証する。
 * prisma は mock.module でスタブ化し、テスト間で reset する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// HACK(agent): bun:test の mock.module はプロセスグローバルなため、
// 全エクスポートをミラーしないとバレルが "export not found" をスローする。
const mockFindFirst = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;

mock.module('../../config/database', () => ({
  prisma: {
    userSession: { findFirst: mockFindFirst },
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
  mockFindFirst.mockReset();
});

describe('resolveSessionByToken', () => {
  test('有効なトークン → session と user を返すこと', async () => {
    const fakeSession = {
      id: 1,
      sessionToken: 'token-abc',
      userId: 42,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400_000),
      user: { id: 42, username: 'alice', email: 'alice@example.com', role: 'user' },
    };
    mockFindFirst.mockResolvedValueOnce(fakeSession);

    const result = await resolveSessionByToken('token-abc');

    expect(result).toEqual(fakeSession);
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    // クエリ条件が sessionToken + expiresAt.gt + include user であることを検証
    const call = mockFindFirst.mock.calls[0][0] as {
      where: { sessionToken: string; expiresAt: { gt: Date } };
      include: { user: boolean };
    };
    expect(call.where.sessionToken).toBe('token-abc');
    expect(call.where.expiresAt.gt).toBeInstanceOf(Date);
    expect(call.include.user).toBe(true);
  });

  test('期限切れ / 存在しないトークン → findFirst が null → null を返すこと', async () => {
    mockFindFirst.mockResolvedValueOnce(null);

    const result = await resolveSessionByToken('expired-token');

    expect(result).toBeNull();
  });

  test('DB reject → null を返すこと（.catch により）', async () => {
    mockFindFirst.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await resolveSessionByToken('any-token');

    expect(result).toBeNull();
  });

  test('クエリ条件が sessionToken + expiresAt.gt + include: { user: true } であること', async () => {
    mockFindFirst.mockResolvedValueOnce(null);

    await resolveSessionByToken('check-query-token');

    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    const call = mockFindFirst.mock.calls[0][0] as {
      where: { sessionToken: string; expiresAt: { gt: unknown } };
      include: { user: boolean };
    };
    expect(call.where.sessionToken).toBe('check-query-token');
    expect(call.where.expiresAt).toHaveProperty('gt');
    expect(call.include).toEqual({ user: true });
  });
});
