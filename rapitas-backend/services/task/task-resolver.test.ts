/**
 * task-resolver ユニットテスト
 *
 * 各 resolveXxx 関数の正常系・異常系を検証する。
 * prisma は mock.module でスタブ化し、テスト間でリセットする。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// HACK(agent): bun:test の mock.module はプロセスグローバルなため、
// 全エクスポートをミラーしないとバレルが "export not found" をスローする。
const mockTaskFindUnique = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;

mock.module('../../config/database', () => ({
  prisma: {
    task: { findUnique: mockTaskFindUnique },
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
  resolveTaskWithTheme,
  resolveTaskWithThemeAndCategory,
  resolveTaskForExecution,
  resolveTaskWorkingDirectory,
} = await import('./task-resolver');

beforeEach(() => {
  mockTaskFindUnique.mockReset();
  mockTaskFindUnique.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// resolveTaskWithTheme
// ---------------------------------------------------------------------------
describe('resolveTaskWithTheme', () => {
  test('タスクが存在する場合 → theme 付きタスクを返すこと', async () => {
    const fakeTask = {
      id: 1,
      themeId: 10,
      workflowStatus: 'draft',
      theme: { workingDirectory: '/projects/app', name: 'My Theme' },
    };
    mockTaskFindUnique.mockResolvedValueOnce(fakeTask);

    const result = await resolveTaskWithTheme(1);
    expect(result).toEqual(fakeTask);
  });

  test('タスクが存在しない場合 → null を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce(null);

    const result = await resolveTaskWithTheme(999);
    expect(result).toBeNull();
  });

  test('DB エラー時 → null を返すこと', async () => {
    mockTaskFindUnique.mockRejectedValueOnce(new Error('DB connection error'));

    const result = await resolveTaskWithTheme(1);
    expect(result).toBeNull();
  });

  test('select 形式で呼ばれること（theme workingDirectory と name を含む）', async () => {
    await resolveTaskWithTheme(42);

    expect(mockTaskFindUnique).toHaveBeenCalledTimes(1);
    const callArgs = mockTaskFindUnique.mock.calls[0][0] as {
      where: { id: number };
      select: Record<string, unknown>;
    };
    expect(callArgs.where.id).toBe(42);
    expect(callArgs.select).toBeDefined();
    expect(callArgs.select.theme).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// resolveTaskWithThemeAndCategory
// ---------------------------------------------------------------------------
describe('resolveTaskWithThemeAndCategory', () => {
  test('タスクが存在する場合 → theme + category 付きタスクを返すこと', async () => {
    const fakeTask = {
      id: 2,
      themeId: 10,
      theme: { id: 10, workingDirectory: '/projects/app', category: { id: 5, name: 'Cat' } },
    };
    mockTaskFindUnique.mockResolvedValueOnce(fakeTask);

    const result = await resolveTaskWithThemeAndCategory(2);
    expect(result).toEqual(fakeTask);
  });

  test('タスクが存在しない場合 → null を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce(null);

    const result = await resolveTaskWithThemeAndCategory(999);
    expect(result).toBeNull();
  });

  test('DB エラー時 → null を返すこと', async () => {
    mockTaskFindUnique.mockRejectedValueOnce(new Error('DB timeout'));

    const result = await resolveTaskWithThemeAndCategory(1);
    expect(result).toBeNull();
  });

  test('include 形式で呼ばれること（theme > category まで含む）', async () => {
    await resolveTaskWithThemeAndCategory(7);

    const callArgs = mockTaskFindUnique.mock.calls[0][0] as {
      where: { id: number };
      include: { theme: { include: { category: boolean } } };
    };
    expect(callArgs.where.id).toBe(7);
    expect(callArgs.include.theme.include.category).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveTaskForExecution
// ---------------------------------------------------------------------------
describe('resolveTaskForExecution', () => {
  test('タスクが存在する場合 → developerModeConfig + theme 付きタスクを返すこと', async () => {
    const fakeTask = {
      id: 3,
      themeId: 10,
      developerModeConfig: { id: 100, taskId: 3 },
      theme: { id: 10, workingDirectory: '/projects/app', isDevelopment: true },
    };
    mockTaskFindUnique.mockResolvedValueOnce(fakeTask);

    const result = await resolveTaskForExecution(3);
    expect(result).toEqual(fakeTask);
  });

  test('タスクが存在しない場合 → null を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce(null);

    const result = await resolveTaskForExecution(999);
    expect(result).toBeNull();
  });

  test('DB エラー時 → null を返すこと', async () => {
    mockTaskFindUnique.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await resolveTaskForExecution(1);
    expect(result).toBeNull();
  });

  test('include に developerModeConfig: true と theme: true が含まれること', async () => {
    await resolveTaskForExecution(5);

    const callArgs = mockTaskFindUnique.mock.calls[0][0] as {
      where: { id: number };
      include: { developerModeConfig: boolean; theme: boolean };
    };
    expect(callArgs.where.id).toBe(5);
    expect(callArgs.include.developerModeConfig).toBe(true);
    expect(callArgs.include.theme).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveTaskWorkingDirectory
// ---------------------------------------------------------------------------
describe('resolveTaskWorkingDirectory', () => {
  test('タスクが存在する場合 → 作業ディレクトリ関連フィールドを返すこと', async () => {
    const fakeTask = {
      themeId: 10,
      workingDirectory: null,
      theme: { workingDirectory: '/projects/app' },
    };
    mockTaskFindUnique.mockResolvedValueOnce(fakeTask);

    const result = await resolveTaskWorkingDirectory(4);
    expect(result).toEqual(fakeTask);
  });

  test('タスクが存在しない場合 → null を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce(null);

    const result = await resolveTaskWorkingDirectory(999);
    expect(result).toBeNull();
  });

  test('DB エラー時 → null を返すこと', async () => {
    mockTaskFindUnique.mockRejectedValueOnce(new Error('Query failed'));

    const result = await resolveTaskWorkingDirectory(1);
    expect(result).toBeNull();
  });

  test('select 形式で呼ばれること（theme workingDirectory のみ）', async () => {
    await resolveTaskWorkingDirectory(8);

    const callArgs = mockTaskFindUnique.mock.calls[0][0] as {
      where: { id: number };
      select: { themeId: boolean; workingDirectory: boolean; theme: unknown };
    };
    expect(callArgs.where.id).toBe(8);
    expect(callArgs.select.themeId).toBe(true);
    expect(callArgs.select.workingDirectory).toBe(true);
    expect(callArgs.select.theme).toBeDefined();
  });
});
