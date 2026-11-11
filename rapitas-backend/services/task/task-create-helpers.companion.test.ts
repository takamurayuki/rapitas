/**
 * task-create-helpers: TaskCompanion created with its task (companion design 4.3, stage 1)
 *
 * A task ラピ creates is accompanied from the moment it exists: its
 * TaskCompanion row is inserted in the same transaction as the task, so a
 * failure between the two inserts rolls both back. The row carries the task's
 * workspaceId (G2 review item 1: a nested write bypassed the workspace
 * extension and left it NULL, invisible to the same workspace's reads and
 * stops). Tasks created any other way get no row.
 *
 * Rows live in an in-memory store (tests/helpers/companion-memory-db.ts) and,
 * for the workspace cases, go through the real workspace extension — so what
 * is asserted is rows, not the arguments a mock received.
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
const { readCompanionState, stopCompanion } = await import('../companion/companion-service');
const { runInWorkspace } = await import('../tenancy/workspace-context');
const { createMemoryDb, scopedByWorkspace } =
  await import('../../tests/helpers/companion-memory-db');

type CompanionDb = import('../companion/companion-service').CompanionDb;

beforeEach(() => {
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
    'origin %s: the task and its open companion row both exist afterwards',
    async (origin) => {
      const db = createMemoryDb();
      await createParentTask(db.client as never, 'parent', undefined, {
        acceptanceCriteria: ['終わっている'],
        companion: { origin },
      });
      expect(db.tables.Task).toHaveLength(1);
      const task = db.tables.Task[0];
      expect(task.acceptanceCriteria).toBe(JSON.stringify(['終わっている']));
      expect(db.tables.TaskCompanion).toEqual([
        expect.objectContaining({ taskId: task.id, origin, closedAt: null }),
      ]);
    },
  );

  test('the person’s checks go to their own column; the jury’s readers never see them (fix2 item 5)', async () => {
    const db = createMemoryDb();
    await createParentTask(db.client as never, 'parent', undefined, {
      acceptanceCriteria: ['API が 200 を返す'],
      userAcceptanceChecks: ['本人が画面を見て納得できる'],
      companion: { origin: 'task_create' },
    });
    const task = db.tables.Task[0];
    expect(task.acceptanceCriteria).toBe(JSON.stringify(['API が 200 を返す']));
    expect(task.userAcceptanceChecks).toBe(JSON.stringify(['本人が画面を見て納得できる']));
    // The existing readers (self-check, review, convergence) read only the
    // jury's column, unchanged — the person's check is not in their input.
    const { parseAcceptanceCriteria: selfCheck } =
      await import('../agents/verification/acceptance-self-check');
    const { parseAcceptanceCriteria: review } =
      await import('../agents/verification/review-acceptance-criteria');
    const { parseAcceptanceCriteria: convergence } = await import('../workflow/verify-convergence');
    for (const read of [selfCheck, review, convergence]) {
      expect(read(task.acceptanceCriteria as string)).toEqual(['API が 200 を返す']);
    }
  });

  test('no person’s checks: the column is not written (older tasks look the same)', async () => {
    const db = createMemoryDb();
    await createParentTask(db.client as never, 'parent', undefined, {
      acceptanceCriteria: ['終わっている'],
      userAcceptanceChecks: [],
      companion: { origin: 'task_create' },
    });
    expect('userAcceptanceChecks' in db.tables.Task[0]).toBe(false);
  });

  test('the row carries the task workspace even with no workspace in context', async () => {
    // A sessionless caller (the agent, a backfill) still writes the task's
    // own workspace onto the row; the extension is not there to stamp it.
    const db = createMemoryDb();
    const realCreate = db.client.task.create as (a: { data: object }) => Promise<unknown>;
    (db.client.task as Record<string, unknown>).create = (a: { data: object }) =>
      realCreate({ data: { ...a.data, workspaceId: 5 } });
    await createParentTask(db.client as never, 'parent', undefined, {
      acceptanceCriteria: ['終わっている'],
      companion: { origin: 'task_create' },
    });
    expect(db.tables.TaskCompanion[0].workspaceId).toBe(5);
  });

  test('a failed companion insert rolls the task back too', async () => {
    const db = createMemoryDb();
    db.failNext('TaskCompanion', 'create', new Error('disk full'));
    await expect(
      createParentTask(db.client as never, 'parent', undefined, {
        acceptanceCriteria: ['終わっている'],
        companion: { origin: 'task_create' },
      }),
    ).rejects.toThrow('disk full');
    expect(db.tables.Task).toEqual([]);
    expect(db.tables.TaskCompanion).toEqual([]);
  });

  test('a task created without one gets no companion row', async () => {
    const db = createMemoryDb();
    await createParentTask(db.client as never, 'parent', undefined, {});
    expect(db.tables.Task).toHaveLength(1);
    expect(db.tables.TaskCompanion).toEqual([]);
  });
});

describe('inside a workspace: create → find → stop (G2 review item 1)', () => {
  test('the row is created in the workspace, found there, and stopped there', async () => {
    const db = createMemoryDb();
    const scoped = scopedByWorkspace(db);
    const companions = scoped as unknown as CompanionDb;

    const created = (await runInWorkspace(7, () =>
      createParentTask(scoped as never, 'ws7 task', undefined, {
        acceptanceCriteria: ['終わっている'],
        companion: { origin: 'task_create' },
      }),
    )) as { id: number } | null;
    expect(created).not.toBeNull();
    const taskId = created!.id;
    expect(db.tables.Task[0].workspaceId).toBe(7);
    expect(db.tables.TaskCompanion[0]).toMatchObject({ taskId, workspaceId: 7 });

    // Found from the same workspace…
    const seen = await runInWorkspace(7, () => readCompanionState(companions, taskId));
    expect(seen).toMatchObject({ ok: true, active: true });
    // …and not from another one.
    const other = await runInWorkspace(8, () => readCompanionState(companions, taskId));
    expect(other).toEqual({ ok: false, reason: 'task_not_found' });
    expect(await runInWorkspace(8, () => stopCompanion(companions, taskId))).toEqual({
      ok: false,
      reason: 'not_active',
    });
    expect(db.tables.TaskCompanion[0].closedAt).toBeNull();

    // Stopped from the same workspace.
    const stopped = await runInWorkspace(7, () => stopCompanion(companions, taskId));
    expect(stopped.ok).toBe(true);
    expect(db.tables.TaskCompanion[0]).toMatchObject({ closedReason: 'stopped_by_user' });
    expect(db.tables.TaskCompanion[0].closedAt).toBeInstanceOf(Date);
  });

  test('control: a row left with a NULL workspace is invisible to that workspace', async () => {
    // What the nested write used to produce. This is why the workspace is
    // written explicitly: scoped reads and stops cannot reach such a row.
    const db = createMemoryDb();
    const scoped = scopedByWorkspace(db) as unknown as CompanionDb;
    db.tables.Task.push({ id: 1, title: 't', status: 'todo', workspaceId: 7 });
    db.tables.TaskCompanion.push({
      id: 1,
      taskId: 1,
      origin: 'task_create',
      workspaceId: null,
      closedAt: null,
    });
    const seen = await runInWorkspace(7, () => readCompanionState(scoped, 1));
    expect(seen).toMatchObject({ ok: true, active: false, companion: null });
    expect(await runInWorkspace(7, () => stopCompanion(scoped, 1))).toEqual({
      ok: false,
      reason: 'not_active',
    });
  });
});
