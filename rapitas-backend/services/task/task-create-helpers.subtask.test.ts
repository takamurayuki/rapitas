/**
 * task-create-helpers: createSubtask ユニットテスト
 *
 * createSubtask の正常系・異常系・境界値を検証する。
 * prisma / logger / user-behavior-service / complexity-analyzer /
 * workflow-mode-config / task-mutations は mock.module でスタブ化する。
 * (createParentTask のテストは task-create-helpers.parent.test.ts に分割。)
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

mock.module('../../src/services/user-behavior-service', () => ({
  UserBehaviorService: {
    recordTaskCreated: mock(() => Promise.resolve()),
    recordTaskStarted: mock(() => Promise.resolve()),
    recordBehavior: mock(() => Promise.resolve()),
  },
}));

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
  analyzeTaskComplexityWithLearning: mock(() => Promise.resolve({ complexityScore: 30 })),
}));

mock.module('../workflow/workflow-mode-config', () => ({
  DEFAULT_MODE_SETTINGS: {},
  invalidateModeConfigCache: mock(() => {}),
  selectModeByComplexity: mock(() => Promise.resolve('standard')),
  MODE_TIER: { lightweight: 0, standard: 1, comprehensive: 2 },
  higherMode: mock((a: string) => a),
  applyProvisionalBias: mock((s: number) => s),
  selectProvisionalMode: mock(() => Promise.resolve('standard')),
  getAllModeSettings: mock(() => Promise.resolve({})),
  getModeSettings: mock(() => Promise.resolve({})),
  updateModeSettings: mock(() => Promise.resolve({})),
  buildTransitions: mock(() => ({})),
  buildRoleByStatus: mock(() => ({})),
  recommendModeFromSettings: mock(() => 'standard'),
}));

const TASK_FULL_INCLUDE = {
  subtasks: { orderBy: { createdAt: 'asc' as const } },
  theme: true,
  project: true,
  milestone: true,
  examGoal: true,
  taskLabels: { include: { label: true } },
} as const;
mock.module('./task-mutations', () => ({
  TASK_FULL_INCLUDE,
  createTask: mock(() => Promise.resolve(null)),
  updateTask: mock(() => Promise.resolve(null)),
}));

const { createSubtask } = await import('./task-create-helpers');

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

type MockFn = ReturnType<typeof mock>;

interface FakeTx {
  task: {
    findFirst: MockFn;
    findUnique: MockFn;
    create: MockFn;
  };
  taskLabel: {
    createMany: MockFn;
  };
}

interface FakePrisma {
  task: {
    findUnique: MockFn;
  };
  $transaction: MockFn;
}

let tx: FakeTx;
let prisma: FakePrisma;

function makeTx(): FakeTx {
  return {
    task: {
      findFirst: mock(() => Promise.resolve(null)),
      findUnique: mock(() => Promise.resolve(null)),
      create: mock((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 1, ...args.data }),
      ),
    },
    taskLabel: {
      createMany: mock(() => Promise.resolve({ count: 0 })),
    },
  };
}

beforeEach(() => {
  tx = makeTx();
  prisma = {
    task: {
      findUnique: mock(() => Promise.resolve(null)),
    },
    $transaction: mock((cb: (tx: FakeTx) => unknown) => cb(tx)),
  };
});

// ---------------------------------------------------------------------------
// createSubtask
// ---------------------------------------------------------------------------
describe('createSubtask', () => {
  test('親タスクが存在しない場合 → エラーを投げること', async () => {
    prisma.task.findUnique.mockResolvedValueOnce(null);

    await expect(
      // HACK(agent): FakePrisma mirrors only the fields task-create-helpers touches.
      createSubtask(prisma as never, 999, 'child', undefined, {}),
    ).rejects.toThrow('親タスク(ID: 999)が見つかりません');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('重複サブタスクが存在する場合 → 既存タスクを返し新規作成しないこと', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 1 });
    tx.task.findFirst.mockResolvedValueOnce({ id: 55, title: 'child' });
    tx.task.findUnique.mockResolvedValueOnce({ id: 55, title: 'child' });

    const result = await createSubtask(prisma as never, 1, 'child', undefined, {});

    expect(result).toEqual({ id: 55, title: 'child' });
    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.task.findUnique).toHaveBeenCalledWith({
      where: { id: 55 },
      include: TASK_FULL_INCLUDE,
    });
  });

  test('重複がない場合 → デフォルトの status/priority で新規作成すること', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 1 });
    tx.task.findFirst.mockResolvedValueOnce(null);
    tx.task.findUnique.mockResolvedValueOnce({ id: 1, title: 'child' });

    await createSubtask(prisma as never, 1, 'child', undefined, {});

    expect(tx.task.create).toHaveBeenCalledTimes(1);
    const callArgs = tx.task.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(callArgs.data.title).toBe('child');
    expect(callArgs.data.status).toBe('todo');
    expect(callArgs.data.priority).toBe('medium');
    expect(callArgs.data.parentId).toBe(1);
    expect(callArgs.data.description).toBeUndefined();
  });

  test('明示的な status/priority が渡された場合 → それを優先すること', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 1 });
    tx.task.findFirst.mockResolvedValueOnce(null);
    tx.task.findUnique.mockResolvedValueOnce({ id: 1 });

    await createSubtask(prisma as never, 1, 'child', undefined, {
      status: 'in-progress',
      priority: 'urgent',
    });

    const callArgs = tx.task.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(callArgs.data.status).toBe('in-progress');
    expect(callArgs.data.priority).toBe('urgent');
  });

  test('goals/constraints/acceptanceCriteria が非空配列の場合 → JSON文字列化して保存すること', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 1 });
    tx.task.findFirst.mockResolvedValueOnce(null);
    tx.task.findUnique.mockResolvedValueOnce({ id: 1 });

    await createSubtask(prisma as never, 1, 'child', undefined, {
      goals: ['ゴールA'],
      constraints: ['制約A'],
      acceptanceCriteria: ['基準A'],
    });

    const callArgs = tx.task.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(callArgs.data.goals).toBe(JSON.stringify(['ゴールA']));
    expect(callArgs.data.constraints).toBe(JSON.stringify(['制約A']));
    expect(callArgs.data.acceptanceCriteria).toBe(JSON.stringify(['基準A']));
  });

  test('goals/constraints/acceptanceCriteria が空配列の場合 → フィールドを含めないこと', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 1 });
    tx.task.findFirst.mockResolvedValueOnce(null);
    tx.task.findUnique.mockResolvedValueOnce({ id: 1 });

    await createSubtask(prisma as never, 1, 'child', undefined, {
      goals: [],
      constraints: [],
      acceptanceCriteria: [],
    });

    const callArgs = tx.task.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(callArgs.data.goals).toBeUndefined();
    expect(callArgs.data.constraints).toBeUndefined();
    expect(callArgs.data.acceptanceCriteria).toBeUndefined();
  });

  test('dueDate が渡された場合 → Date に変換すること', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 1 });
    tx.task.findFirst.mockResolvedValueOnce(null);
    tx.task.findUnique.mockResolvedValueOnce({ id: 1 });

    await createSubtask(prisma as never, 1, 'child', undefined, {
      dueDate: '2026-01-01',
    });

    const callArgs = tx.task.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(callArgs.data.dueDate).toEqual(new Date('2026-01-01'));
  });

  test('themeId/examGoalId が 0 の場合 → undefined チェックのため含まれること', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 1 });
    tx.task.findFirst.mockResolvedValueOnce(null);
    tx.task.findUnique.mockResolvedValueOnce({ id: 1 });

    await createSubtask(prisma as never, 1, 'child', undefined, {
      themeId: 0,
      examGoalId: 0,
    });

    const callArgs = tx.task.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(callArgs.data.themeId).toBe(0);
    expect(callArgs.data.examGoalId).toBe(0);
  });

  test('isDeveloperMode/isAiTaskAnalysis が false の場合 → undefined チェックのため含まれること', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 1 });
    tx.task.findFirst.mockResolvedValueOnce(null);
    tx.task.findUnique.mockResolvedValueOnce({ id: 1 });

    await createSubtask(prisma as never, 1, 'child', undefined, {
      isDeveloperMode: false,
      isAiTaskAnalysis: false,
    });

    const callArgs = tx.task.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(callArgs.data.isDeveloperMode).toBe(false);
    expect(callArgs.data.isAiTaskAnalysis).toBe(false);
  });

  test('labelIds が非空の場合 → tx.taskLabel.createMany を呼ぶこと', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 1 });
    tx.task.findFirst.mockResolvedValueOnce(null);
    tx.task.findUnique.mockResolvedValueOnce({ id: 1 });

    await createSubtask(prisma as never, 1, 'child', [10, 20], {});

    expect(tx.taskLabel.createMany).toHaveBeenCalledWith({
      data: [
        { taskId: 1, labelId: 10 },
        { taskId: 1, labelId: 20 },
      ],
    });
  });

  test('labelIds が空配列の場合 → tx.taskLabel.createMany を呼ばないこと', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 1 });
    tx.task.findFirst.mockResolvedValueOnce(null);
    tx.task.findUnique.mockResolvedValueOnce({ id: 1 });

    await createSubtask(prisma as never, 1, 'child', [], {});

    expect(tx.taskLabel.createMany).not.toHaveBeenCalled();
  });

  test('labelIds が undefined の場合 → tx.taskLabel.createMany を呼ばないこと', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 1 });
    tx.task.findFirst.mockResolvedValueOnce(null);
    tx.task.findUnique.mockResolvedValueOnce({ id: 1 });

    await createSubtask(prisma as never, 1, 'child', undefined, {});

    expect(tx.taskLabel.createMany).not.toHaveBeenCalled();
  });

  test('$transaction が Serializable 分離レベルで呼ばれること', async () => {
    prisma.task.findUnique.mockResolvedValueOnce({ id: 1 });
    tx.task.findFirst.mockResolvedValueOnce(null);
    tx.task.findUnique.mockResolvedValueOnce({ id: 1 });

    await createSubtask(prisma as never, 1, 'child', undefined, {});

    const opts = prisma.$transaction.mock.calls[0][1] as { isolationLevel: string };
    expect(opts.isolationLevel).toBe('Serializable');
  });
});
