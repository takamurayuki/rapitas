/**
 * task-create-helpers: createParentTask ユニットテスト
 *
 * createParentTask の正常系・異常系・境界値を検証する。
 * prisma / logger / user-behavior-service / complexity-analyzer /
 * workflow-mode-config / task-mutations は mock.module でスタブ化する。
 * (createSubtask のテストは task-create-helpers.subtask.test.ts に分割。)
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// HACK(agent): bun:test の mock.module はプロセスグローバルなため、
// 全エクスポートをミラーしないとバレルが "export not found" をスローする。

const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const mockRecordTaskCreated = mock(() => Promise.resolve());
mock.module('../../src/services/user-behavior-service', () => ({
  UserBehaviorService: {
    recordTaskCreated: mockRecordTaskCreated,
    recordTaskStarted: mock(() => Promise.resolve()),
    recordBehavior: mock(() => Promise.resolve()),
  },
}));

const mockAnalyzeTaskComplexityWithLearning = mock(() => Promise.resolve({ complexityScore: 30 }));
mock.module('../workflow/complexity-analyzer', () => ({
  LIGHTWEIGHT_KEYWORDS: [],
  HEAVYWEIGHT_KEYWORDS: [],
  LIGHTWEIGHT_LABEL_KEYWORDS: [],
  HEAVYWEIGHT_LABEL_KEYWORDS: [],
  analyzeKeywords: mock(() => ({})),
  analyzeEstimatedTime: mock(() => ({})),
  analyzePriority: mock(() => ({})),
  analyzeLabels: mock(() => ({})),
  analyzeScope: mock(() => ({})),
  getRecommendedMode: mock(() => 'lightweight'),
  calculateEstimatedExecutionTime: mock(() => 0),
  calculateConfidence: mock(() => 0),
  analyzeTaskComplexity: mock(() => ({})),
  analyzeBatchComplexity: mock(() => []),
  getWorkflowModeConfig: mock(() => ({})),
  analyzeTaskComplexityWithLearning: mockAnalyzeTaskComplexityWithLearning,
}));

const mockGetAllModeSettings = mock(() => Promise.resolve({}));
const mockRecommendModeFromSettings = mock(() => 'standard');
mock.module('../workflow/workflow-mode-config', () => ({
  DEFAULT_MODE_SETTINGS: {},
  invalidateModeConfigCache: mock(() => {}),
  selectModeByComplexity: mock(() => Promise.resolve('standard')),
  MODE_TIER: { lightweight: 0, standard: 1, comprehensive: 2 },
  higherMode: mock((a: string) => a),
  applyProvisionalBias: mock((s: number) => s),
  selectProvisionalMode: mock(() => Promise.resolve('standard')),
  getAllModeSettings: mockGetAllModeSettings,
  getModeSettings: mock(() => Promise.resolve({})),
  updateModeSettings: mock(() => Promise.resolve({})),
  buildTransitions: mock(() => ({})),
  buildRoleByStatus: mock(() => ({})),
  recommendModeFromSettings: mockRecommendModeFromSettings,
}));

// NOTE: applyModeRules is dynamically imported by createParentTask and,
// unmocked, reaches the real prisma client (config/index.ts) — causing
// timeouts and out-of-order mockResolvedValueOnce consumption across tests.
const mockApplyModeRules = mock((_task: unknown, _complexityScore: number, baseMode: string) =>
  Promise.resolve({ mode: baseMode, ruleIds: [] as number[], reasons: [] as string[] }),
);
mock.module('../workflow/learning/workflow-learning-optimizer', () => ({
  recordWorkflowCompletion: mock(() => Promise.resolve()),
  getLearningStats: mock(() => Promise.resolve({})),
  calculatePhaseTimings: mock(() => ({})),
  extractKeywords: mock(() => []),
  detectSkippedPhases: mock(() => []),
  matchesCondition: mock(() => false),
  estimateDurationFromHistory: mock(() => Promise.resolve(null)),
  getDirectInsight: mock(() => Promise.resolve(null)),
  generateOptimizationRules: mock(() => Promise.resolve({})),
  applyModeRules: mockApplyModeRules,
  getWorkflowRecommendation: mock(() => Promise.resolve({})),
}));

mock.module('./task-mutations', () => ({
  TASK_FULL_INCLUDE: {
    subtasks: { orderBy: { createdAt: 'asc' as const } },
    theme: true,
    project: true,
    milestone: true,
    examGoal: true,
    taskLabels: { include: { label: true } },
  },
  createTask: mock(() => Promise.resolve(null)),
  updateTask: mock(() => Promise.resolve(null)),
}));

const { createParentTask } = await import('./task-create-helpers');

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

type MockFn = ReturnType<typeof mock>;

interface FakePrisma {
  task: {
    findUnique: MockFn;
    create: MockFn;
    update: MockFn;
  };
  taskLabel: {
    createMany: MockFn;
  };
}

let prisma: FakePrisma;

beforeEach(() => {
  prisma = {
    task: {
      findUnique: mock(() => Promise.resolve(null)),
      create: mock((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 100, ...args.data }),
      ),
      update: mock(() => Promise.resolve({})),
    },
    taskLabel: {
      createMany: mock(() => Promise.resolve({ count: 0 })),
    },
  };
  mockRecordTaskCreated.mockReset();
  mockRecordTaskCreated.mockResolvedValue(undefined);
  mockAnalyzeTaskComplexityWithLearning.mockReset();
  mockAnalyzeTaskComplexityWithLearning.mockResolvedValue({ complexityScore: 30 });
  mockGetAllModeSettings.mockReset();
  mockGetAllModeSettings.mockResolvedValue({});
  mockRecommendModeFromSettings.mockReset();
  mockRecommendModeFromSettings.mockReturnValue('standard');
  mockApplyModeRules.mockReset();
  mockApplyModeRules.mockImplementation(
    (_task: unknown, _complexityScore: number, baseMode: string) =>
      Promise.resolve({ mode: baseMode, ruleIds: [], reasons: [] }),
  );
});

// ---------------------------------------------------------------------------
// createParentTask
// ---------------------------------------------------------------------------
describe('createParentTask', () => {
  test('デフォルトの status/priority で新規作成すること', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 100, taskLabels: [] });

    const result = await createParentTask(prisma as never, 'parent', undefined, {});

    expect(prisma.task.create).toHaveBeenCalledTimes(1);
    const callArgs = prisma.task.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(callArgs.data.status).toBe('todo');
    expect(callArgs.data.priority).toBe('medium');
    expect(result).toEqual({ id: 100, taskLabels: [] });
  });

  test('labelIds が非空の場合 → prisma.taskLabel.createMany を呼ぶこと', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 100, taskLabels: [] });

    await createParentTask(prisma as never, 'parent', [1, 2], {});

    expect(prisma.taskLabel.createMany).toHaveBeenCalledWith({
      data: [
        { taskId: 100, labelId: 1 },
        { taskId: 100, labelId: 2 },
      ],
    });
  });

  test('labelIds が未指定の場合 → prisma.taskLabel.createMany を呼ばないこと', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 100, taskLabels: [] });

    await createParentTask(prisma as never, 'parent', undefined, {});

    expect(prisma.taskLabel.createMany).not.toHaveBeenCalled();
  });

  test('作成タスクが取得できた場合 → UserBehaviorService.recordTaskCreated を呼ぶこと', async () => {
    const createdTask = { id: 100, taskLabels: [] };
    prisma.task.findUnique.mockResolvedValueOnce(createdTask);

    await createParentTask(prisma as never, 'parent', undefined, {});

    expect(mockRecordTaskCreated).toHaveBeenCalledWith(100, createdTask);
  });

  test('findUnique が null を返す場合 → recordTaskCreated も複雑度分析も呼ばず null を返すこと', async () => {
    prisma.task.findUnique.mockResolvedValueOnce(null);

    const result = await createParentTask(prisma as never, 'parent', undefined, {});

    expect(result).toBeNull();
    expect(mockRecordTaskCreated).not.toHaveBeenCalled();
    expect(mockAnalyzeTaskComplexityWithLearning).not.toHaveBeenCalled();
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  test('複雑度分析が成功した場合 → workflowMode のみ更新し、ヒューリスティックscoreは永続化しないこと', async () => {
    // NOTE: complexityScore is reserved for the research agent's code-grounded
    // assessment (applyResearchAssessedComplexity) — the creation-time metadata
    // heuristic only picks the initial mode and must NOT be persisted.
    prisma.task.findUnique.mockResolvedValueOnce({ id: 100, taskLabels: [] });
    mockAnalyzeTaskComplexityWithLearning.mockResolvedValueOnce({ complexityScore: 42 });
    mockGetAllModeSettings.mockResolvedValueOnce({ lightweight: {} });
    mockRecommendModeFromSettings.mockReturnValueOnce('comprehensive');

    await createParentTask(prisma as never, 'parent', undefined, {});

    expect(mockRecommendModeFromSettings).toHaveBeenCalledWith(42, { lightweight: {} });
    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { workflowMode: 'comprehensive' },
    });
  });

  test('複雑度分析が失敗した場合 → エラーを握りつぶし createdTask をそのまま返すこと', async () => {
    const createdTask = { id: 100, taskLabels: [] };
    prisma.task.findUnique.mockResolvedValueOnce(createdTask);
    mockAnalyzeTaskComplexityWithLearning.mockRejectedValueOnce(new Error('AI down'));

    const result = await createParentTask(prisma as never, 'parent', undefined, {});

    expect(result).toEqual(createdTask);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  test('taskLabels が存在する場合 → 複雑度分析の labels にラベル名を渡すこと', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({
      id: 100,
      taskLabels: [{ label: { name: 'bug' } }, { label: { name: 'urgent' } }],
    });

    await createParentTask(prisma as never, 'parent', undefined, {});

    const input = mockAnalyzeTaskComplexityWithLearning.mock.calls[0][0] as {
      labels: string[];
    };
    expect(input.labels).toEqual(['bug', 'urgent']);
  });

  test('taskLabels が undefined の場合 → 複雑度分析の labels は空配列であること', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 100 });

    await createParentTask(prisma as never, 'parent', undefined, {});

    const input = mockAnalyzeTaskComplexityWithLearning.mock.calls[0][0] as {
      labels: string[];
    };
    expect(input.labels).toEqual([]);
  });

  test('priority 未指定の場合 → 複雑度分析へは medium を渡すこと', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 100, taskLabels: [] });

    await createParentTask(prisma as never, 'parent', undefined, {});

    const input = mockAnalyzeTaskComplexityWithLearning.mock.calls[0][0] as {
      priority: string;
    };
    expect(input.priority).toBe('medium');
  });

  test('goals/constraints/acceptanceCriteria/themeId が複雑度分析に渡されること', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 100, taskLabels: [] });

    await createParentTask(prisma as never, 'parent', undefined, {
      themeId: 7,
      goals: ['g1'],
      constraints: ['c1'],
      acceptanceCriteria: ['a1'],
    });

    const input = mockAnalyzeTaskComplexityWithLearning.mock.calls[0][0] as {
      themeId?: number;
      goals?: string[];
      constraints?: string[];
      acceptanceCriteria?: string[];
    };
    expect(input.themeId).toBe(7);
    expect(input.goals).toEqual(['g1']);
    expect(input.constraints).toEqual(['c1']);
    expect(input.acceptanceCriteria).toEqual(['a1']);
  });
});
