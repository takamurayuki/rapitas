/**
 * resource-guard ユニットテスト
 *
 * resolveOrThrow 基底関数と各 named wrapper の正常系・異常系を検証する。
 * prisma は mock.module でスタブ化し、テスト間で復元する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { NotFoundError, ValidationError } from '../../middleware/error-handler';

// HACK(agent): bun:test の mock.module はプロセスグローバルなため、
// 全エクスポートをミラーしないとバレルが "export not found" をスローする。
const mockFindUniquePr = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;
const mockFindUniqueIssue = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;
const mockFindUniqueIntegration = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;

mock.module('../../config/database', () => ({
  prisma: {
    gitHubPullRequest: { findUnique: mockFindUniquePr },
    gitHubIssue: { findUnique: mockFindUniqueIssue },
    gitHubIntegration: { findUnique: mockFindUniqueIntegration },
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

const { resolveOrThrow, resolvePrOrThrow, resolveIssueOrThrow, resolveIntegrationOrThrow } =
  await import('./resource-guard');

beforeEach(() => {
  mockFindUniquePr.mockReset();
  mockFindUniqueIssue.mockReset();
  mockFindUniqueIntegration.mockReset();
});

// ---------------------------------------------------------------------------
// resolveOrThrow — 汎用基底
// ---------------------------------------------------------------------------
describe('resolveOrThrow', () => {
  test('レコードがある場合そのまま返すこと', async () => {
    const record = { id: 1, name: 'test' };
    const result = await resolveOrThrow(() => Promise.resolve(record), 'not found');
    expect(result).toBe(record);
  });

  test('null の場合 NotFoundError をスローすること', async () => {
    await expect(
      resolveOrThrow(() => Promise.resolve(null), 'Resource not found', 'RES_NOT_FOUND'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('undefined の場合も NotFoundError をスローすること', async () => {
    await expect(
      resolveOrThrow(() => Promise.resolve(undefined), 'Resource not found'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('message と code が例外に伝播すること', async () => {
    let caught: NotFoundError | null = null;
    try {
      await resolveOrThrow(() => Promise.resolve(null), 'Custom message', 'CUSTOM_CODE');
    } catch (e) {
      caught = e as NotFoundError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toBe('Custom message');
    expect(caught!.code).toBe('CUSTOM_CODE');
    expect(caught!.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// resolvePrOrThrow
// ---------------------------------------------------------------------------
describe('resolvePrOrThrow', () => {
  const fakePr = {
    id: 1,
    prNumber: 42,
    title: 'Feature',
    integration: { id: 1, ownerName: 'owner', repositoryName: 'repo' },
  };

  test('PRが存在する場合 ResolvedPr を返すこと', async () => {
    mockFindUniquePr.mockResolvedValueOnce(fakePr);
    const result = await resolvePrOrThrow('1');
    expect(result).toBe(fakePr);
  });

  test('include: { integration: true } を渡して findUnique を呼ぶこと', async () => {
    mockFindUniquePr.mockResolvedValueOnce(fakePr);
    await resolvePrOrThrow('1');
    // HACK(agent): bun の mock 型は calls を unknown で持つため any キャスト
    const calls = mockFindUniquePr.mock.calls as unknown as Array<
      [{ where: { id: number }; include: { integration: boolean } }]
    >;
    expect(calls[0][0].where.id).toBe(1);
    expect(calls[0][0].include.integration).toBe(true);
  });

  test('PRが存在しない場合 NotFoundError(404, PR_NOT_FOUND) をスローすること', async () => {
    mockFindUniquePr.mockResolvedValueOnce(null);
    let caught: NotFoundError | null = null;
    try {
      await resolvePrOrThrow('999');
    } catch (e) {
      caught = e as NotFoundError;
    }
    expect(caught).toBeInstanceOf(NotFoundError);
    expect(caught!.statusCode).toBe(404);
    expect(caught!.code).toBe('PR_NOT_FOUND');
  });

  test('不正な ID("abc") の場合 ValidationError(400) をスローすること', async () => {
    await expect(resolvePrOrThrow('abc')).rejects.toBeInstanceOf(ValidationError);
  });

  test('不正な ID("0") の場合 ValidationError(400) をスローすること', async () => {
    await expect(resolvePrOrThrow('0')).rejects.toBeInstanceOf(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// resolveIssueOrThrow
// ---------------------------------------------------------------------------
describe('resolveIssueOrThrow', () => {
  const fakeIssue = {
    id: 5,
    issueNumber: 10,
    title: 'Bug report',
    integration: { id: 1, ownerName: 'owner', repositoryName: 'repo' },
  };

  test('Issueが存在する場合 ResolvedIssue を返すこと', async () => {
    mockFindUniqueIssue.mockResolvedValueOnce(fakeIssue);
    const result = await resolveIssueOrThrow('5');
    expect(result).toBe(fakeIssue);
  });

  test('include: { integration: true } を渡して findUnique を呼ぶこと', async () => {
    mockFindUniqueIssue.mockResolvedValueOnce(fakeIssue);
    await resolveIssueOrThrow('5');
    const calls = mockFindUniqueIssue.mock.calls as unknown as Array<
      [{ where: { id: number }; include: { integration: boolean } }]
    >;
    expect(calls[0][0].include.integration).toBe(true);
  });

  test('Issueが存在しない場合 NotFoundError(404, ISSUE_NOT_FOUND) をスローすること', async () => {
    mockFindUniqueIssue.mockResolvedValueOnce(null);
    let caught: NotFoundError | null = null;
    try {
      await resolveIssueOrThrow('999');
    } catch (e) {
      caught = e as NotFoundError;
    }
    expect(caught).toBeInstanceOf(NotFoundError);
    expect(caught!.statusCode).toBe(404);
    expect(caught!.code).toBe('ISSUE_NOT_FOUND');
  });

  test('不正な ID("xyz") の場合 ValidationError(400) をスローすること', async () => {
    await expect(resolveIssueOrThrow('xyz')).rejects.toBeInstanceOf(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// resolveIntegrationOrThrow
// ---------------------------------------------------------------------------
describe('resolveIntegrationOrThrow', () => {
  const fakeIntegration = {
    id: 2,
    ownerName: 'acme',
    repositoryName: 'api',
    repositoryUrl: 'https://github.com/acme/api',
  };

  test('Integrationが存在する場合 ResolvedIntegration を返すこと', async () => {
    mockFindUniqueIntegration.mockResolvedValueOnce(fakeIntegration);
    const result = await resolveIntegrationOrThrow('2');
    expect(result).toBe(fakeIntegration);
  });

  test('Integrationが存在しない場合 NotFoundError(404, INTEGRATION_NOT_FOUND) をスローすること', async () => {
    mockFindUniqueIntegration.mockResolvedValueOnce(null);
    let caught: NotFoundError | null = null;
    try {
      await resolveIntegrationOrThrow('999');
    } catch (e) {
      caught = e as NotFoundError;
    }
    expect(caught).toBeInstanceOf(NotFoundError);
    expect(caught!.statusCode).toBe(404);
    expect(caught!.code).toBe('INTEGRATION_NOT_FOUND');
  });

  test('数値で渡した場合も機能すること', async () => {
    mockFindUniqueIntegration.mockResolvedValueOnce(fakeIntegration);
    const result = await resolveIntegrationOrThrow(2);
    expect(result).toBe(fakeIntegration);
  });
});
