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
  resolveTaskWorkflowState,
  resolveTaskTitle,
  resolveTaskThemeId,
  resolveTaskForComplexityAnalysis,
  resolveTaskSubtaskInfo,
  resolveTaskForPlanApproval,
  resolveTaskForAutoMerge,
  resolveTaskForLearning,
} = await import('./task-resolver');

beforeEach(() => {
  mockTaskFindUnique.mockReset();
  mockTaskFindUnique.mockResolvedValue(null);
});

/** null-return パスのパラメータテーブル（全 resolver 共通） */
type NullReturnCase = { label: string; id: number; setup: (m: ReturnType<typeof mock>) => void };

const nullReturnCases: NullReturnCase[] = [
  { label: 'not found', id: 999, setup: (m) => m.mockResolvedValueOnce(null) },
  { label: 'DB error', id: 1, setup: (m) => m.mockRejectedValueOnce(new Error('DB error')) },
  { label: 'id=0 (boundary)', id: 0, setup: (m) => m.mockResolvedValueOnce(null) },
  { label: 'id=-1 (negative)', id: -1, setup: (m) => m.mockResolvedValueOnce(null) },
  {
    label: 'id=MAX_SAFE_INTEGER (upper bound)',
    id: Number.MAX_SAFE_INTEGER,
    setup: (m) => m.mockResolvedValueOnce(null),
  },
];

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

  test.each(nullReturnCases)('$label → null', async ({ id, setup }) => {
    setup(mockTaskFindUnique);
    const result = await resolveTaskWithTheme(id);
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

  test.each(nullReturnCases)('$label → null', async ({ id, setup }) => {
    setup(mockTaskFindUnique);
    const result = await resolveTaskWithThemeAndCategory(id);
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

  test.each(nullReturnCases)('$label → null', async ({ id, setup }) => {
    setup(mockTaskFindUnique);
    const result = await resolveTaskForExecution(id);
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

  test.each(nullReturnCases)('$label → null', async ({ id, setup }) => {
    setup(mockTaskFindUnique);
    const result = await resolveTaskWorkingDirectory(id);
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

// ---------------------------------------------------------------------------
// resolveTaskWorkflowState
// ---------------------------------------------------------------------------
describe('resolveTaskWorkflowState', () => {
  test('タスクが存在する場合 → ワークフロー状態スカラーを返すこと', async () => {
    const fakeTask = {
      id: 10,
      status: 'in-progress',
      workflowStatus: 'in_progress',
      workflowMode: 'standard',
      parentId: null,
    };
    mockTaskFindUnique.mockResolvedValueOnce(fakeTask);

    const result = await resolveTaskWorkflowState(10);
    expect(result).toEqual(fakeTask);
  });

  test.each(nullReturnCases)('$label → null', async ({ id, setup }) => {
    setup(mockTaskFindUnique);
    const result = await resolveTaskWorkflowState(id);
    expect(result).toBeNull();
  });

  test('select に id/status/workflowStatus/workflowMode/parentId が含まれること', async () => {
    await resolveTaskWorkflowState(20);

    const callArgs = mockTaskFindUnique.mock.calls[0][0] as {
      where: { id: number };
      select: Record<string, boolean>;
    };
    expect(callArgs.where.id).toBe(20);
    expect(callArgs.select.id).toBe(true);
    expect(callArgs.select.status).toBe(true);
    expect(callArgs.select.workflowStatus).toBe(true);
    expect(callArgs.select.workflowMode).toBe(true);
    expect(callArgs.select.parentId).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveTaskTitle
// ---------------------------------------------------------------------------
describe('resolveTaskTitle', () => {
  test('タスクが存在する場合 → id と title を返すこと', async () => {
    const fakeTask = { id: 5, title: 'テストタスク' };
    mockTaskFindUnique.mockResolvedValueOnce(fakeTask);

    const result = await resolveTaskTitle(5);
    expect(result).toEqual(fakeTask);
  });

  test.each(nullReturnCases)('$label → null', async ({ id, setup }) => {
    setup(mockTaskFindUnique);
    const result = await resolveTaskTitle(id);
    expect(result).toBeNull();
  });

  test('select に id と title のみが含まれること', async () => {
    await resolveTaskTitle(7);

    const callArgs = mockTaskFindUnique.mock.calls[0][0] as {
      where: { id: number };
      select: Record<string, boolean>;
    };
    expect(callArgs.where.id).toBe(7);
    expect(callArgs.select.id).toBe(true);
    expect(callArgs.select.title).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveTaskThemeId
// ---------------------------------------------------------------------------
describe('resolveTaskThemeId', () => {
  test('タスクが存在する場合 → id と themeId を返すこと', async () => {
    const fakeTask = { id: 3, themeId: 42 };
    mockTaskFindUnique.mockResolvedValueOnce(fakeTask);

    const result = await resolveTaskThemeId(3);
    expect(result).toEqual(fakeTask);
  });

  test.each(nullReturnCases)('$label → null', async ({ id, setup }) => {
    setup(mockTaskFindUnique);
    const result = await resolveTaskThemeId(id);
    expect(result).toBeNull();
  });

  test('select に id と themeId のみが含まれること', async () => {
    await resolveTaskThemeId(11);

    const callArgs = mockTaskFindUnique.mock.calls[0][0] as {
      where: { id: number };
      select: Record<string, boolean>;
    };
    expect(callArgs.where.id).toBe(11);
    expect(callArgs.select.id).toBe(true);
    expect(callArgs.select.themeId).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveTaskForComplexityAnalysis
// ---------------------------------------------------------------------------
describe('resolveTaskForComplexityAnalysis', () => {
  test('タスクが存在する場合 → theme・taskLabels 付きタスクを返すこと', async () => {
    const fakeTask = {
      id: 15,
      title: '複雑度分析対象',
      theme: { id: 10, workingDirectory: '/proj' },
      taskLabels: [{ label: { name: 'bug' } }],
    };
    mockTaskFindUnique.mockResolvedValueOnce(fakeTask);

    const result = await resolveTaskForComplexityAnalysis(15);
    expect(result).toEqual(fakeTask);
  });

  test.each(nullReturnCases)('$label → null', async ({ id, setup }) => {
    setup(mockTaskFindUnique);
    const result = await resolveTaskForComplexityAnalysis(id);
    expect(result).toBeNull();
  });

  test('include に theme: true と taskLabels.label が含まれること', async () => {
    await resolveTaskForComplexityAnalysis(16);

    const callArgs = mockTaskFindUnique.mock.calls[0][0] as {
      where: { id: number };
      include: { theme: boolean; taskLabels: { include: { label: boolean } } };
    };
    expect(callArgs.where.id).toBe(16);
    expect(callArgs.include.theme).toBe(true);
    expect(callArgs.include.taskLabels.include.label).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveTaskSubtaskInfo
// ---------------------------------------------------------------------------
describe('resolveTaskSubtaskInfo', () => {
  test('タスクが存在する場合 → id・parentId・title を返すこと', async () => {
    const fakeTask = { id: 10, parentId: 5, title: 'サブタスクA' };
    mockTaskFindUnique.mockResolvedValueOnce(fakeTask);

    const result = await resolveTaskSubtaskInfo(10);
    expect(result).toEqual(fakeTask);
  });

  test.each(nullReturnCases)('$label → null', async ({ id, setup }) => {
    setup(mockTaskFindUnique);
    const result = await resolveTaskSubtaskInfo(id);
    expect(result).toBeNull();
  });

  test('select に id・parentId・title が含まれること', async () => {
    await resolveTaskSubtaskInfo(10);

    const callArgs = mockTaskFindUnique.mock.calls[0][0] as {
      where: { id: number };
      select: Record<string, boolean>;
    };
    expect(callArgs.where.id).toBe(10);
    expect(callArgs.select.id).toBe(true);
    expect(callArgs.select.parentId).toBe(true);
    expect(callArgs.select.title).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveTaskForPlanApproval
// ---------------------------------------------------------------------------
describe('resolveTaskForPlanApproval', () => {
  test('タスクが存在する場合 → id・autoApprovePlan・parentId を返すこと', async () => {
    const fakeTask = { id: 20, autoApprovePlan: true, parentId: null };
    mockTaskFindUnique.mockResolvedValueOnce(fakeTask);

    const result = await resolveTaskForPlanApproval(20);
    expect(result).toEqual(fakeTask);
  });

  test.each(nullReturnCases)('$label → null', async ({ id, setup }) => {
    setup(mockTaskFindUnique);
    const result = await resolveTaskForPlanApproval(id);
    expect(result).toBeNull();
  });

  test('select に id・autoApprovePlan・parentId が含まれること', async () => {
    await resolveTaskForPlanApproval(20);

    const callArgs = mockTaskFindUnique.mock.calls[0][0] as {
      where: { id: number };
      select: Record<string, boolean>;
    };
    expect(callArgs.where.id).toBe(20);
    expect(callArgs.select.id).toBe(true);
    expect(callArgs.select.autoApprovePlan).toBe(true);
    expect(callArgs.select.parentId).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveTaskForAutoMerge
// ---------------------------------------------------------------------------
describe('resolveTaskForAutoMerge', () => {
  test('タスクが存在する場合 → 自動マージ候補フィールドを返すこと', async () => {
    const fakeTask = {
      id: 30,
      title: 'マージ対象タスク',
      status: 'done',
      workflowStatus: 'completed',
      completedAt: new Date('2025-01-01'),
      workingDirectory: '/projects/task-30',
      theme: { workingDirectory: '/projects/main' },
    };
    mockTaskFindUnique.mockResolvedValueOnce(fakeTask);

    const result = await resolveTaskForAutoMerge(30);
    expect(result).toEqual(fakeTask);
  });

  test.each(nullReturnCases)('$label → null', async ({ id, setup }) => {
    setup(mockTaskFindUnique);
    const result = await resolveTaskForAutoMerge(id);
    expect(result).toBeNull();
  });

  test('select に id・title・status・workflowStatus・completedAt・workingDirectory・theme が含まれること', async () => {
    await resolveTaskForAutoMerge(30);

    const callArgs = mockTaskFindUnique.mock.calls[0][0] as {
      where: { id: number };
      select: Record<string, unknown>;
    };
    expect(callArgs.where.id).toBe(30);
    expect(callArgs.select.id).toBe(true);
    expect(callArgs.select.title).toBe(true);
    expect(callArgs.select.status).toBe(true);
    expect(callArgs.select.workflowStatus).toBe(true);
    expect(callArgs.select.completedAt).toBe(true);
    expect(callArgs.select.workingDirectory).toBe(true);
    expect(callArgs.select.theme).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// resolveTaskForLearning
// ---------------------------------------------------------------------------
describe('resolveTaskForLearning', () => {
  test('タスクが存在する場合 → theme・category・taskLabels 付きタスクを返すこと', async () => {
    const fakeTask = {
      id: 40,
      title: '学習対象タスク',
      theme: { id: 5, categoryId: 2, category: { id: 2, name: 'Backend' } },
      taskLabels: [{ label: { name: 'refactor' } }],
    };
    mockTaskFindUnique.mockResolvedValueOnce(fakeTask);

    const result = await resolveTaskForLearning(40);
    expect(result).toEqual(fakeTask);
  });

  test.each(nullReturnCases)('$label → null', async ({ id, setup }) => {
    setup(mockTaskFindUnique);
    const result = await resolveTaskForLearning(id);
    expect(result).toBeNull();
  });

  test('include に theme（category含む）と taskLabels（label含む）が含まれること', async () => {
    await resolveTaskForLearning(40);

    const callArgs = mockTaskFindUnique.mock.calls[0][0] as {
      where: { id: number };
      include: {
        theme: { include: { category: boolean } };
        taskLabels: { include: { label: boolean } };
      };
    };
    expect(callArgs.where.id).toBe(40);
    expect(callArgs.include.theme.include.category).toBe(true);
    expect(callArgs.include.taskLabels.include.label).toBe(true);
  });
});
