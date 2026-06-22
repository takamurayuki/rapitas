/**
 * task-resolver ユニットテスト
 *
 * resolveTaskWorkingDirectory / resolveTaskContext / resolveTaskWorkflowContext の
 * 正常系・異常系を検証する。prisma は mock.module でスタブ化し、テスト間でリセットする。
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

const { resolveTaskWorkingDirectory, resolveTaskContext, resolveTaskWorkflowContext } =
  await import('./task-resolver');

beforeEach(() => {
  mockTaskFindUnique.mockReset();
  mockTaskFindUnique.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// resolveTaskWorkingDirectory
// ---------------------------------------------------------------------------
describe('resolveTaskWorkingDirectory', () => {
  test('task.workingDirectory がある場合 → それを返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      workingDirectory: '/projects/foo',
      theme: { workingDirectory: '/projects/theme' },
    });
    const result = await resolveTaskWorkingDirectory(1);
    expect(result).toBe('/projects/foo');
  });

  test('task.workingDirectory が null でテーマの値がある場合 → テーマの値を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      workingDirectory: null,
      theme: { workingDirectory: '/projects/theme' },
    });
    const result = await resolveTaskWorkingDirectory(1);
    expect(result).toBe('/projects/theme');
  });

  test('両方 null の場合 → null を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      workingDirectory: null,
      theme: { workingDirectory: null },
    });
    const result = await resolveTaskWorkingDirectory(1);
    expect(result).toBeNull();
  });

  test('task が存在しない場合 → null を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce(null);
    const result = await resolveTaskWorkingDirectory(1);
    expect(result).toBeNull();
  });

  test('DB が reject した場合 → null を返すこと（.catch により）', async () => {
    mockTaskFindUnique.mockRejectedValueOnce(new Error('DB error'));
    const result = await resolveTaskWorkingDirectory(1);
    expect(result).toBeNull();
  });

  test('クエリの where/select が正しいこと', async () => {
    await resolveTaskWorkingDirectory(42);
    expect(mockTaskFindUnique).toHaveBeenCalledTimes(1);
    const callArgs = mockTaskFindUnique.mock.calls[0][0] as {
      where: { id: number };
      select: { workingDirectory: boolean; theme: { select: { workingDirectory: boolean } } };
    };
    expect(callArgs.where).toEqual({ id: 42 });
    expect(callArgs.select.workingDirectory).toBe(true);
    expect(callArgs.select.theme.select.workingDirectory).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveTaskContext
// ---------------------------------------------------------------------------
describe('resolveTaskContext', () => {
  test('task.workingDirectory あり → workingDirectory と themeId を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      workingDirectory: '/projects/foo',
      themeId: 5,
      theme: { workingDirectory: '/projects/theme' },
    });
    const result = await resolveTaskContext(1);
    expect(result).toEqual({ workingDirectory: '/projects/foo', themeId: 5 });
  });

  test('task.workingDirectory が null → theme fallback になること', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      workingDirectory: null,
      themeId: 3,
      theme: { workingDirectory: '/projects/theme' },
    });
    const result = await resolveTaskContext(1);
    expect(result).toEqual({ workingDirectory: '/projects/theme', themeId: 3 });
  });

  test('両方 null の場合 → { workingDirectory: null, themeId: ... } を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      workingDirectory: null,
      themeId: 2,
      theme: { workingDirectory: null },
    });
    const result = await resolveTaskContext(1);
    expect(result).toEqual({ workingDirectory: null, themeId: 2 });
  });

  test('task が存在しない場合 → { workingDirectory: null, themeId: null } を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce(null);
    const result = await resolveTaskContext(1);
    expect(result).toEqual({ workingDirectory: null, themeId: null });
  });

  test('DB が reject した場合 → { workingDirectory: null, themeId: null } を返すこと', async () => {
    mockTaskFindUnique.mockRejectedValueOnce(new Error('DB error'));
    const result = await resolveTaskContext(1);
    expect(result).toEqual({ workingDirectory: null, themeId: null });
  });

  test('select に themeId が含まれること', async () => {
    await resolveTaskContext(7);
    const callArgs = mockTaskFindUnique.mock.calls[0][0] as {
      select: { themeId: boolean };
    };
    expect(callArgs.select.themeId).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveTaskWorkflowContext
// ---------------------------------------------------------------------------
describe('resolveTaskWorkflowContext', () => {
  test('task がある場合 → workflowStatus と workflowMode を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      workflowStatus: 'in_progress',
      workflowMode: 'standard',
    });
    const result = await resolveTaskWorkflowContext(1);
    expect(result).toEqual({ workflowStatus: 'in_progress', workflowMode: 'standard' });
  });

  test('workflowStatus が null の場合 → null を含むオブジェクトを返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({ workflowStatus: null, workflowMode: null });
    const result = await resolveTaskWorkflowContext(1);
    expect(result).toEqual({ workflowStatus: null, workflowMode: null });
  });

  test('task が存在しない場合 → null を返すこと', async () => {
    mockTaskFindUnique.mockResolvedValueOnce(null);
    const result = await resolveTaskWorkflowContext(1);
    expect(result).toBeNull();
  });

  test('DB が reject した場合 → null を返すこと', async () => {
    mockTaskFindUnique.mockRejectedValueOnce(new Error('DB error'));
    const result = await resolveTaskWorkflowContext(1);
    expect(result).toBeNull();
  });

  test('クエリの select が workflowStatus と workflowMode を含むこと', async () => {
    await resolveTaskWorkflowContext(9);
    const callArgs = mockTaskFindUnique.mock.calls[0][0] as {
      select: { workflowStatus: boolean; workflowMode: boolean };
    };
    expect(callArgs.select.workflowStatus).toBe(true);
    expect(callArgs.select.workflowMode).toBe(true);
  });
});
