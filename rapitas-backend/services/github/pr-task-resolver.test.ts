/**
 * pr-task-resolver ユニットテスト
 *
 * pull-requests.ts から抽出した3関数（titleMatchesTask / resolvePrWorkingDirectory /
 * findPrViaGh）の正常系・異常系を検証する。
 * prisma・gh-client は mock.module でスタブ化し、テスト間で復元する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { NUMERIC_ID_BOUNDARIES } from '../../tests/helpers/boundary-values';

// HACK(agent): bun:test の mock.module はプロセスグローバルなため、
// 全エクスポートをミラーしないとバレルが "export not found" をスローする。
const mockTaskFindUnique = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;

mock.module('../../config/database', () => ({
  prisma: {
    task: { findUnique: mockTaskFindUnique },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const mockRunGhCommand = mock(() => Promise.resolve('[]')) as ReturnType<typeof mock>;

mock.module('./gh-client', () => ({
  runGhCommand: mockRunGhCommand,
  // NOTE: mirror all exports so barrel imports don't throw "export not found"
  GH_BIN: '',
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

const { titleMatchesTask, resolvePrWorkingDirectory, resolvePrTaskContext, findPrViaGh } =
  await import('./pr-task-resolver');

beforeEach(() => {
  mockTaskFindUnique.mockReset();
  mockRunGhCommand.mockReset();
  mockRunGhCommand.mockResolvedValue('[]');
});

// ---------------------------------------------------------------------------
// titleMatchesTask
// ---------------------------------------------------------------------------
describe('titleMatchesTask', () => {
  test('[Task-N] 形式マッチ → true を返すこと', () => {
    expect(titleMatchesTask('[Task-5] fix something', 5)).toBe(true);
  });

  test('[#N] 形式マッチ → true を返すこと', () => {
    expect(titleMatchesTask('[#5] fix something', 5)).toBe(true);
  });

  test('タスクIDが異なる場合 false を返すこと', () => {
    expect(titleMatchesTask('[Task-5] fix', 6)).toBe(false);
  });

  test('無関係なタイトル → false を返すこと', () => {
    expect(titleMatchesTask('some unrelated PR title', 5)).toBe(false);
  });

  test('null タイトル → false を返すこと', () => {
    expect(titleMatchesTask(null, 5)).toBe(false);
  });

  test('undefined タイトル → false を返すこと', () => {
    expect(titleMatchesTask(undefined, 5)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolvePrWorkingDirectory
// ---------------------------------------------------------------------------
describe('resolvePrWorkingDirectory', () => {
  test('linkedTaskId が null → null を返し DB クエリを発行しないこと', async () => {
    const result = await resolvePrWorkingDirectory(null);
    expect(result).toBeNull();
    expect(mockTaskFindUnique).not.toHaveBeenCalled();
  });

  test('task.workingDirectory がある → そのパスを返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      workingDirectory: '/repo/path',
      theme: { workingDirectory: '/theme/path' },
    });
    const result = await resolvePrWorkingDirectory(1);
    expect(result).toBe('/repo/path');
  });

  test('task.workingDirectory が null → theme.workingDirectory にフォールバックすること', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      workingDirectory: null,
      theme: { workingDirectory: '/theme/path' },
    });
    const result = await resolvePrWorkingDirectory(1);
    expect(result).toBe('/theme/path');
  });

  test('task・theme 両方 null → null を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      workingDirectory: null,
      theme: { workingDirectory: null },
    });
    const result = await resolvePrWorkingDirectory(1);
    expect(result).toBeNull();
  });

  test('findUnique が reject → null を返すこと（.catch により）', async () => {
    mockTaskFindUnique.mockRejectedValueOnce(new Error('DB error'));
    const result = await resolvePrWorkingDirectory(1);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolvePrTaskContext
// ---------------------------------------------------------------------------
describe('resolvePrTaskContext', () => {
  test('linkedTaskId が null → { workingDirectory: null, themeId: null } を返しDBクエリを発行しないこと', async () => {
    const result = await resolvePrTaskContext(null);
    expect(result).toEqual({ workingDirectory: null, themeId: null });
    expect(mockTaskFindUnique).not.toHaveBeenCalled();
  });

  test('task.workingDirectory あり → そのパスと themeId を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      workingDirectory: '/repo/path',
      themeId: 7,
      theme: { workingDirectory: '/theme/path' },
    });
    const result = await resolvePrTaskContext(1);
    expect(result).toEqual({ workingDirectory: '/repo/path', themeId: 7 });
  });

  test('task.workingDirectory が null → theme.workingDirectory にフォールバックし themeId を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      workingDirectory: null,
      themeId: 3,
      theme: { workingDirectory: '/theme/path' },
    });
    const result = await resolvePrTaskContext(1);
    expect(result).toEqual({ workingDirectory: '/theme/path', themeId: 3 });
  });

  test('findUnique が reject → { workingDirectory: null, themeId: null } を返すこと', async () => {
    mockTaskFindUnique.mockRejectedValueOnce(new Error('DB error'));
    const result = await resolvePrTaskContext(1);
    expect(result).toEqual({ workingDirectory: null, themeId: null });
  });
});

// ---------------------------------------------------------------------------
// findPrViaGh
// ---------------------------------------------------------------------------
describe('findPrViaGh', () => {
  test('gh 成功・タイトル一致 PR あり → { prNumber, prUrl } を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      workingDirectory: '/repo',
      theme: { workingDirectory: null },
    });
    mockRunGhCommand.mockResolvedValueOnce(
      JSON.stringify([
        {
          number: 42,
          url: 'https://github.com/owner/repo/pull/42',
          title: '[Task-10] add feature',
        },
      ]),
    );
    const result = await findPrViaGh(10);
    expect(result).toEqual({ prNumber: 42, prUrl: 'https://github.com/owner/repo/pull/42' });
  });

  test('PR 一覧にタスク対応なし → null を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      workingDirectory: '/repo',
      theme: { workingDirectory: null },
    });
    mockRunGhCommand.mockResolvedValueOnce(
      JSON.stringify([
        { number: 99, url: 'https://github.com/owner/repo/pull/99', title: 'unrelated PR' },
      ]),
    );
    const result = await findPrViaGh(10);
    expect(result).toBeNull();
  });

  test('runGhCommand が throw → null を返すこと（catch により）', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      workingDirectory: '/repo',
      theme: { workingDirectory: null },
    });
    mockRunGhCommand.mockRejectedValueOnce(new Error('gh error'));
    const result = await findPrViaGh(10);
    expect(result).toBeNull();
  });

  test('resolvePrWorkingDirectory が null → runGhCommand を呼ばず null を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce(null);
    const result = await findPrViaGh(10);
    expect(result).toBeNull();
    expect(mockRunGhCommand).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 境界値テスト: titleMatchesTask の id 境界値・特殊ケース
// ---------------------------------------------------------------------------
describe('titleMatchesTask 境界値', () => {
  test('[Task-0] 形式で id=0 → true を返すこと（仮説 #3381 回帰固定）', () => {
    expect(titleMatchesTask('[Task-0] zero id task', 0)).toBe(true);
  });

  test('[#0] 形式で id=0 → true を返すこと（仮説 #3381 回帰固定）', () => {
    expect(titleMatchesTask('[#0] zero id task', 0)).toBe(true);
  });

  test.each(NUMERIC_ID_BOUNDARIES)(
    'id=$label のとき、対応しないタイトル → false を返すこと',
    ({ value }) => {
      expect(titleMatchesTask('unrelated PR title', value)).toBe(false);
    },
  );

  test('空文字タイトル → false を返すこと', () => {
    expect(titleMatchesTask('', 5)).toBe(false);
  });

  test('[Task-N] と [#N] 両方含む複合タイトル → true を返すこと', () => {
    expect(titleMatchesTask('[Task-5] [#5] dual format', 5)).toBe(true);
  });
});
