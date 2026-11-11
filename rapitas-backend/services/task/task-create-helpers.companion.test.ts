/**
 * task-create-helpers: TaskCompanion nested create (companion design 4.3, stage 1)
 *
 * A task ラピ creates is accompanied from the moment it exists: its
 * TaskCompanion row is part of the same `task.create` (a nested write, one
 * statement), so no failure between two inserts can leave an accompanied task
 * without its row. Tasks created any other way get no row.
 *
 * Mock setup mirrors task-create-helpers.parent.test.ts (mock.module is
 * process-global, so every export is mirrored there too).
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

describe('createParentTask with a companion', () => {
  test.each(['task_create', 'roadmap_commit'] as const)(
    'origin %s: the companion row is created inside the same task.create',
    async (origin) => {
      prisma.task.findUnique.mockResolvedValueOnce({ id: 100, taskLabels: [] });
      await createParentTask(prisma as never, 'parent', undefined, {
        acceptanceCriteria: ['終わっている'],
        companion: { origin },
      });
      expect(prisma.task.create).toHaveBeenCalledTimes(1);
      const { data } = prisma.task.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(data.companion).toEqual({ create: { origin } });
      expect(data.acceptanceCriteria).toBe(JSON.stringify(['終わっている']));
    },
  );

  test('a task created without one gets no companion row', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 100, taskLabels: [] });
    await createParentTask(prisma as never, 'parent', undefined, {});
    const { data } = prisma.task.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).not.toHaveProperty('companion');
  });
});
