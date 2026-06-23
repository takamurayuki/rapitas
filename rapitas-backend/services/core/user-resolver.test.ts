/**
 * user-resolver ユニットテスト
 *
 * resolveUserByEmail / resolveUserByUsernameOrEmail の正常系・異常系を検証する。
 * prisma は mock.module でスタブ化し、テスト間でリセットする。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { STRING_EDGES } from '../../tests/helpers/boundary-values';

// HACK(agent): bun:test の mock.module はプロセスグローバルなため、
// 全エクスポートをミラーしないとバレルが "export not found" をスローする。
const mockUserFindFirst = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;

mock.module('../../config/database', () => ({
  prisma: {
    user: { findFirst: mockUserFindFirst },
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

const { resolveUserByEmail, resolveUserByUsernameOrEmail } = await import('./user-resolver');

beforeEach(() => {
  mockUserFindFirst.mockReset();
  mockUserFindFirst.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// resolveUserByEmail
// ---------------------------------------------------------------------------
describe('resolveUserByEmail', () => {
  test('ユーザーが存在する場合 → ユーザー行を返すこと', async () => {
    const fakeUser = {
      id: 1,
      username: 'testuser',
      email: 'test@example.com',
      role: 'user',
      createdAt: new Date(),
    };
    mockUserFindFirst.mockResolvedValueOnce(fakeUser);

    const result = await resolveUserByEmail('test@example.com');
    expect(result).toEqual(fakeUser);
  });

  test('ユーザーが存在しない場合 → null を返すこと', async () => {
    mockUserFindFirst.mockResolvedValueOnce(null);

    const result = await resolveUserByEmail('notfound@example.com');
    expect(result).toBeNull();
  });

  test('DB エラー時 → null を返すこと', async () => {
    mockUserFindFirst.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await resolveUserByEmail('test@example.com');
    expect(result).toBeNull();
  });

  test('where: { email } で呼ばれること', async () => {
    await resolveUserByEmail('check@example.com');

    expect(mockUserFindFirst).toHaveBeenCalledTimes(1);
    const callArgs = mockUserFindFirst.mock.calls[0][0] as { where: { email: string } };
    expect(callArgs.where.email).toBe('check@example.com');
  });

  // 境界値テスト: STRING_EDGES で定義された文字列入力の異常系
  const STRING_BOUNDARY_CASES: Array<{ label: string; email: string }> = [
    { label: '空文字列', email: STRING_EDGES.EMPTY },
    // NOTE: DBレコードが存在しない前提に依存。このメールを持つ行がなければ null を返す。
    { label: '空白のみ文字列', email: STRING_EDGES.WHITESPACE_ONLY },
  ];
  for (const { label, email } of STRING_BOUNDARY_CASES) {
    test(`境界値メール [${label}] → null を返すこと`, async () => {
      const result = await resolveUserByEmail(email);
      expect(result).toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
// resolveUserByUsernameOrEmail
// ---------------------------------------------------------------------------
describe('resolveUserByUsernameOrEmail', () => {
  test('username で一致する場合 → ユーザー行を返すこと', async () => {
    const fakeUser = {
      id: 2,
      username: 'johndoe',
      email: 'john@example.com',
      role: 'user',
      createdAt: new Date(),
    };
    mockUserFindFirst.mockResolvedValueOnce(fakeUser);

    const result = await resolveUserByUsernameOrEmail('johndoe', 'john@example.com');
    expect(result).toEqual(fakeUser);
  });

  test('ユーザーが存在しない場合 → null を返すこと', async () => {
    mockUserFindFirst.mockResolvedValueOnce(null);

    const result = await resolveUserByUsernameOrEmail('unknown', 'unknown@example.com');
    expect(result).toBeNull();
  });

  test('DB エラー時 → null を返すこと', async () => {
    mockUserFindFirst.mockRejectedValueOnce(new Error('Query timeout'));

    const result = await resolveUserByUsernameOrEmail('user', 'user@example.com');
    expect(result).toBeNull();
  });

  test('where: { OR: [{ username }, { email }] } で呼ばれること', async () => {
    await resolveUserByUsernameOrEmail('alice', 'alice@example.com');

    expect(mockUserFindFirst).toHaveBeenCalledTimes(1);
    const callArgs = mockUserFindFirst.mock.calls[0][0] as {
      where: { OR: Array<{ username?: string; email?: string }> };
    };
    expect(callArgs.where.OR).toEqual([{ username: 'alice' }, { email: 'alice@example.com' }]);
  });
});
