/**
 * user-resolver ユニットテスト
 *
 * resolveUserByEmail / resolveUserByUsernameOrEmail の正常系・異常系を検証する。
 * prisma は mock.module でスタブ化し、テスト間でリセットする。
 */
import { describe, test, it, expect, mock, beforeEach } from 'bun:test';
import { STRING_EDGES, toNameTuples, BOUNDARY_STRINGS } from '../../tests/helpers/boundary-values';

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

  /** null-return パスのパラメータテーブル（メールアドレス入力 + 空文字/空白境界値） */
  type EmailNullReturnCase = {
    label: string;
    email: string;
    setup: (m: ReturnType<typeof mock>) => void;
  };

  const emailNullReturnCases: EmailNullReturnCase[] = [
    {
      label: 'not found',
      email: 'notfound@example.com',
      setup: (m) => m.mockResolvedValueOnce(null),
    },
    {
      label: 'DB error',
      email: 'test@example.com',
      setup: (m) => m.mockRejectedValueOnce(new Error('DB connection lost')),
    },
    {
      label: 'empty string email (boundary)',
      email: '',
      setup: (m) => m.mockResolvedValueOnce(null),
    },
    {
      label: 'whitespace-only email (boundary)',
      email: ' ',
      setup: (m) => m.mockResolvedValueOnce(null),
    },
  ];

  test.each(emailNullReturnCases)('$label → null', async ({ email, setup }) => {
    setup(mockUserFindFirst);
    const result = await resolveUserByEmail(email);
    expect(result).toBeNull();
  });

  test('where: { email } で呼ばれること', async () => {
    await resolveUserByEmail('check@example.com');

    expect(mockUserFindFirst).toHaveBeenCalledTimes(1);
    const callArgs = mockUserFindFirst.mock.calls[0][0] as { where: { email: string } };
    expect(callArgs.where.email).toBe('check@example.com');
  });

  describe('境界値: 空・空白文字列メール → null を返し where.email に値が伝播すること', () => {
    it.each(toNameTuples(STRING_EDGES))('email "%s" → null', async (_label, input) => {
      const result = await resolveUserByEmail(input);
      expect(result).toBeNull();

      expect(mockUserFindFirst).toHaveBeenCalledTimes(1);
      const callArgs = mockUserFindFirst.mock.calls[0][0] as { where: { email: string } };
      expect(callArgs.where.email).toBe(input);
    });
  });
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

  /** null-return パスのパラメータテーブル（username/email ペア入力 + 空文字/空白境界値） */
  type UsernameOrEmailNullReturnCase = {
    label: string;
    username: string;
    email: string;
    setup: (m: ReturnType<typeof mock>) => void;
  };

  const usernameOrEmailNullReturnCases: UsernameOrEmailNullReturnCase[] = [
    {
      label: 'not found',
      username: 'unknown',
      email: 'unknown@example.com',
      setup: (m) => m.mockResolvedValueOnce(null),
    },
    {
      label: 'DB error',
      username: 'user',
      email: 'user@example.com',
      setup: (m) => m.mockRejectedValueOnce(new Error('Query timeout')),
    },
    {
      label: 'empty string inputs (boundary)',
      username: '',
      email: '',
      setup: (m) => m.mockResolvedValueOnce(null),
    },
    {
      label: 'whitespace-only inputs (boundary)',
      username: ' ',
      email: ' ',
      setup: (m) => m.mockResolvedValueOnce(null),
    },
  ];

  test.each(usernameOrEmailNullReturnCases)('$label → null', async ({ username, email, setup }) => {
    setup(mockUserFindFirst);
    const result = await resolveUserByUsernameOrEmail(username, email);
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

// ---------------------------------------------------------------------------
// 境界値テスト: 文字列型フィールドの境界値で resolver が例外を投げず null を返すこと
// ---------------------------------------------------------------------------
describe('resolver 境界値: 文字列型フィールド', () => {
  test.each(BOUNDARY_STRINGS)(
    'resolveUserByEmail(email=$label) → null を返し例外を投げないこと（現挙動の回帰固定）',
    async ({ value }) => {
      const result = await resolveUserByEmail(value);
      expect(result).toBeNull();
    },
  );
});
