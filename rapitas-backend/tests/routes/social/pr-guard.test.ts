/**
 * PR Guard Unit Tests
 * resolvePrOrThrow の単体テスト（正常系・各エラー分岐）
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { NotFoundError, ValidationError } from '../../../middleware/error-handler';

// NOTE: Must mirror every export of config/database — barrel re-exports require all symbols.
const mockFindUnique = mock(() => Promise.resolve(null)) as any;
const mockPrisma = {
  gitHubPullRequest: {
    findUnique: mockFindUnique,
  },
};

mock.module('../../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../config/logger', () => {
  const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
  return {
    createLogger: () => noopLogger,
    logger: noopLogger,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

const { resolvePrOrThrow } = await import('../../../routes/social/pr-guard');

const mockPr = {
  id: 1,
  prNumber: 42,
  title: 'Feature PR',
  integration: {
    id: 10,
    ownerName: 'octocat',
    repositoryName: 'hello-world',
  },
};

describe('resolvePrOrThrow', () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
  });

  test('PRが存在する場合に {pr, repo} を返すこと', async () => {
    mockFindUnique.mockResolvedValue(mockPr);

    const result = await resolvePrOrThrow('1');

    expect(result.pr).toEqual(mockPr);
    expect(result.repo).toBe('octocat/hello-world');
  });

  test('repo 文字列が ownerName/repositoryName の形式かつ小文字正規化されること', async () => {
    const customPr = {
      ...mockPr,
      integration: { id: 11, ownerName: 'myOrg', repositoryName: 'my-repo' },
    };
    mockFindUnique.mockResolvedValue(customPr);

    const result = await resolvePrOrThrow(1);

    // NOTE: makeOwnerRepoString lowercases both components for gh CLI safety
    expect(result.repo).toBe('myorg/my-repo');
  });

  test('数値IDでも動作すること', async () => {
    mockFindUnique.mockResolvedValue(mockPr);

    const result = await resolvePrOrThrow(1);

    expect(result.pr.id).toBe(1);
  });

  test('PRが存在しない場合に NotFoundError (404) を throw すること', async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(resolvePrOrThrow('999')).rejects.toThrow(NotFoundError);

    try {
      await resolvePrOrThrow('999');
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).statusCode).toBe(404);
      expect((err as NotFoundError).code).toBe('PR_NOT_FOUND');
    }
  });

  test('integration が null の場合に NotFoundError (404) を throw すること', async () => {
    mockFindUnique.mockResolvedValue({ ...mockPr, integration: null });

    try {
      await resolvePrOrThrow('1');
      throw new Error('例外が発生すべきでした');
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).statusCode).toBe(404);
      expect((err as NotFoundError).code).toBe('PR_INTEGRATION_NOT_FOUND');
    }
  });

  test('不正な ID (文字列) の場合に ValidationError (400) を throw すること', async () => {
    try {
      await resolvePrOrThrow('abc');
      throw new Error('例外が発生すべきでした');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).statusCode).toBe(400);
    }
  });

  test('ID が 0 の場合に ValidationError (400) を throw すること', async () => {
    try {
      await resolvePrOrThrow('0');
      throw new Error('例外が発生すべきでした');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).statusCode).toBe(400);
    }
  });

  test('ID が負の数の場合に ValidationError (400) を throw すること', async () => {
    try {
      await resolvePrOrThrow('-5');
      throw new Error('例外が発生すべきでした');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).statusCode).toBe(400);
    }
  });

  test('PR不在時に findUnique が呼ばれ外部APIは呼ばれないこと（モック呼び出し回数検証）', async () => {
    mockFindUnique.mockResolvedValue(null);

    try {
      await resolvePrOrThrow('42');
    } catch {
      // 期待通りの例外
    }

    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });
});
