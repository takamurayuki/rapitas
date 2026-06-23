/**
 * auth-session-resolver ユニットテスト
 *
 * resolveSessionByToken の正常系・異常系を検証する。
 * prisma は mock.module でスタブ化し、テスト間でリセットする。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { STRING_EDGES } from '../../tests/helpers/boundary-values';

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

  test('期限切れ / 一致なしの場合 → findFirst が null → null を返すこと', async () => {
    mockUserSessionFindFirst.mockResolvedValueOnce(null);

    const result = await resolveSessionByToken('expired-or-missing-token');
    expect(result).toBeNull();
  });

  test('DB が reject した場合 → null を返すこと（.catch により）', async () => {
    mockUserSessionFindFirst.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await resolveSessionByToken('any-token');
    expect(result).toBeNull();
  });

  // 境界値テスト: STRING_EDGES で定義されたトークン異常系
  const TOKEN_BOUNDARY_CASES: Array<{ label: string; token: string }> = [
    { label: '空文字列トークン', token: STRING_EDGES.EMPTY },
    // NOTE: DBレコードが存在しない前提に依存。このトークンを持つ行がなければ null を返す。
    { label: '空白のみトークン', token: STRING_EDGES.WHITESPACE_ONLY },
  ];
  for (const { label, token } of TOKEN_BOUNDARY_CASES) {
    test(`境界値トークン [${label}] → null を返すこと`, async () => {
      const result = await resolveSessionByToken(token);
      expect(result).toBeNull();
    });
  }

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
