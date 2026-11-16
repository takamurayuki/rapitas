/**
 * task-create-helpers: createSubtask workspace inheritance
 *
 * A subtask must belong to its parent's workspace even when the request that
 * creates it carries no session. The workspace extension only stamps a
 * workspace when one is in context, and sessionless requests (the agent, a
 * page that lost its cookie) have none — that left tasks 1428/1480/1481 with
 * workspaceId NULL under parents in workspace 1, invisible to the signed-in
 * client that then failed to update them as "not found".
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
  taskLabels: { include: { label: true } },
} as const;
mock.module('./task-mutations', () => ({
  TASK_FULL_INCLUDE,
  createTask: mock(() => Promise.resolve(null)),
  updateTask: mock(() => Promise.resolve(null)),
}));

const { createSubtask } = await import('./task-create-helpers');

type MockFn = ReturnType<typeof mock>;

let txCreate: MockFn;
let parentFindUnique: MockFn;
let prisma: { task: { findUnique: MockFn }; $transaction: MockFn };

beforeEach(() => {
  txCreate = mock((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 7, ...args.data }),
  );
  const tx = {
    task: {
      findFirst: mock(() => Promise.resolve(null)),
      findUnique: mock(() => Promise.resolve({ id: 7 })),
      create: txCreate,
    },
    taskLabel: { createMany: mock(() => Promise.resolve({ count: 0 })) },
  };
  parentFindUnique = mock(() => Promise.resolve({ id: 532, workspaceId: 1 }));
  prisma = {
    task: { findUnique: parentFindUnique },
    $transaction: mock((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
});

/** The `data` createSubtask handed to tx.task.create. */
function createdData(): Record<string, unknown> {
  return (txCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
}

describe('createSubtask workspace inheritance', () => {
  test('stamps the parent workspace onto the subtask', async () => {
    // HACK(agent): the fake mirrors only the fields task-create-helpers touches.
    await createSubtask(prisma as never, 532, 'test', undefined, {});
    expect(createdData().workspaceId).toBe(1);
  });

  test('reads the parent workspace when looking the parent up', async () => {
    await createSubtask(prisma as never, 532, 'test', undefined, {});
    const args = parentFindUnique.mock.calls[0][0] as { select: Record<string, boolean> };
    expect(args.select.workspaceId).toBe(true);
  });

  test('leaves workspaceId unset when the parent has none', async () => {
    parentFindUnique.mockResolvedValueOnce({ id: 532, workspaceId: null });
    await createSubtask(prisma as never, 532, 'test', undefined, {});
    expect('workspaceId' in createdData()).toBe(false);
  });
});
