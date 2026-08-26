/**
 * workflow/learning/workflow-learning-stats ユニットテスト
 *
 * recordWorkflowCompletion（タスク未検出・作成成功・例外握りつぶし）と
 * getLearningStats（モード別集計・成功率・上書き率・精度・直近30日分布）を
 * prisma / task-resolver / complexity-analyzer / learning-helpers を
 * モックして検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const activityLogFindMany = mock(() => Promise.resolve([] as unknown[]));
const workflowLearningRecordCreate = mock((args: unknown) => Promise.resolve(args));
const workflowLearningRecordFindMany = mock(() => Promise.resolve([] as unknown[]));
// actualDurationMinutes is now WORK time — the sum of the task's executions —
// not `completedAt - createdAt`, which counted backlog queueing as duration.
const agentExecutionFindMany = mock(() =>
  Promise.resolve([{ executionTimeMs: 6 * 60_000 }, { executionTimeMs: 4 * 60_000 }]),
);

mock.module('../../../config', () => ({
  prisma: {
    activityLog: { findMany: activityLogFindMany },
    agentExecution: { findMany: agentExecutionFindMany },
    workflowLearningRecord: {
      create: workflowLearningRecordCreate,
      findMany: workflowLearningRecordFindMany,
    },
  },
}));

const mockResolveTaskForLearning = mock(() => Promise.resolve(null as unknown));
mock.module('../../task/task-resolver', () => ({
  resolveTaskForLearning: mockResolveTaskForLearning,
  taskRowConfirmedAbsent: mock(() => Promise.resolve(false)),
}));

const mockAnalyzeTaskComplexity = mock(() => ({
  complexityScore: 42,
  estimatedExecutionTime: 60,
  analysisBreakdown: { keyword: 1 },
}));
mock.module('../complexity-analyzer', () => ({
  analyzeTaskComplexity: mockAnalyzeTaskComplexity,
}));

mock.module('./workflow-learning-helpers', () => ({
  calculatePhaseTimings: mock(() => ({ research: 10 })),
  extractKeywords: mock(() => ['keyword1']),
  detectSkippedPhases: mock(() => []),
}));

const { recordWorkflowCompletion, getLearningStats } = await import('./workflow-learning-stats');

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: 'Task title',
    description: 'desc',
    estimatedHours: 2,
    taskLabels: [],
    priority: 'medium',
    themeId: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    completedAt: new Date('2026-01-01T01:00:00.000Z'),
    workflowMode: 'standard',
    complexityScore: null,
    workflowModeOverride: false,
    status: 'done',
    theme: { categoryId: 5 },
    ...overrides,
  };
}

describe('recordWorkflowCompletion', () => {
  beforeEach(() => {
    activityLogFindMany.mockClear();
    workflowLearningRecordCreate.mockClear();
    mockResolveTaskForLearning.mockReset();
    mockResolveTaskForLearning.mockImplementation(() => Promise.resolve(null));
  });

  test('does nothing (no create call) when the task is not found', async () => {
    await recordWorkflowCompletion(999);
    expect(workflowLearningRecordCreate).not.toHaveBeenCalled();
  });

  test('creates a learning record with the expected shape for a completed task', async () => {
    mockResolveTaskForLearning.mockImplementation(() => Promise.resolve(makeTask()));
    await recordWorkflowCompletion(1);

    expect(workflowLearningRecordCreate).toHaveBeenCalledTimes(1);
    const call = workflowLearningRecordCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.taskId).toBe(1);
    expect(call.data.workflowMode).toBe('standard');
    // 6 + 4 minutes of execution. The fixture's task spans an hour of wall
    // clock; that hour is lead time and no longer counts as duration.
    expect(call.data.actualDurationMinutes).toBe(10);
    expect(call.data.outcome).toBe('completed');
    expect(call.data.success).toBe(true);
    expect(call.data.categoryId).toBe(5);
  });

  test('marks outcome as cancelled and success false when task status is not done', async () => {
    mockResolveTaskForLearning.mockImplementation(() =>
      Promise.resolve(makeTask({ status: 'cancelled' })),
    );
    await recordWorkflowCompletion(1);
    const call = workflowLearningRecordCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.outcome).toBe('cancelled');
    expect(call.data.success).toBe(false);
  });

  test('sets actualDurationMinutes to null when completedAt is missing', async () => {
    mockResolveTaskForLearning.mockImplementation(() =>
      Promise.resolve(makeTask({ completedAt: null })),
    );
    await recordWorkflowCompletion(1);
    const call = workflowLearningRecordCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.actualDurationMinutes).toBeNull();
  });

  test('defaults workflowMode to "comprehensive" when the task has none', async () => {
    mockResolveTaskForLearning.mockImplementation(() =>
      Promise.resolve(makeTask({ workflowMode: null })),
    );
    await recordWorkflowCompletion(1);
    const call = workflowLearningRecordCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.workflowMode).toBe('comprehensive');
  });

  test('extracts overriddenFrom from a workflow_mode_changed activity log', async () => {
    mockResolveTaskForLearning.mockImplementation(() => Promise.resolve(makeTask()));
    activityLogFindMany.mockImplementationOnce(() =>
      Promise.resolve([
        {
          action: 'workflow_mode_changed',
          metadata: JSON.stringify({ previousMode: 'lightweight' }),
        },
      ]),
    );
    await recordWorkflowCompletion(1);
    const call = workflowLearningRecordCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.overriddenFrom).toBe('lightweight');
  });

  test('treats malformed metadata JSON as no override (does not throw)', async () => {
    mockResolveTaskForLearning.mockImplementation(() => Promise.resolve(makeTask()));
    activityLogFindMany.mockImplementationOnce(() =>
      Promise.resolve([{ action: 'workflow_mode_changed', metadata: 'not json' }]),
    );
    await recordWorkflowCompletion(1);
    const call = workflowLearningRecordCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.overriddenFrom).toBeNull();
  });

  test('swallows an unexpected error instead of throwing', async () => {
    mockResolveTaskForLearning.mockImplementation(() => Promise.reject(new Error('db down')));
    await expect(recordWorkflowCompletion(1)).resolves.toBeUndefined();
  });
});

describe('getLearningStats', () => {
  beforeEach(() => {
    workflowLearningRecordFindMany.mockClear();
  });

  test('returns zeroed stats when there are no records', async () => {
    workflowLearningRecordFindMany.mockImplementationOnce(() => Promise.resolve([]));
    const stats = await getLearningStats();
    expect(stats.totalRecords).toBe(0);
    expect(stats.overrideRate).toBe(0);
    expect(stats.avgAccuracy).toBe(0);
    expect(stats.byMode).toEqual({});
  });

  test('aggregates count/avgDuration/successRate per workflow mode', async () => {
    workflowLearningRecordFindMany.mockImplementationOnce(() =>
      Promise.resolve([
        {
          workflowMode: 'standard',
          actualDurationMinutes: 60,
          success: true,
          outcome: 'completed',
          wasOverridden: false,
          estimatedDuration: 60,
          createdAt: new Date(),
        },
        {
          workflowMode: 'standard',
          actualDurationMinutes: 40,
          success: false,
          outcome: 'cancelled',
          wasOverridden: false,
          estimatedDuration: 60,
          createdAt: new Date(),
        },
      ]),
    );
    const stats = await getLearningStats();
    expect(stats.totalRecords).toBe(2);
    expect(stats.byMode.standard.count).toBe(2);
    expect(stats.byMode.standard.avgDuration).toBe(50); // (60+40)/2
    expect(stats.byMode.standard.successRate).toBe(0.5); // 1 of 2 succeeded
    expect(stats.byOutcome.completed).toBe(1);
    expect(stats.byOutcome.cancelled).toBe(1);
  });

  test('computes overrideRate as the fraction of records marked wasOverridden', async () => {
    workflowLearningRecordFindMany.mockImplementationOnce(() =>
      Promise.resolve([
        {
          workflowMode: 'standard',
          success: true,
          outcome: 'completed',
          wasOverridden: true,
          createdAt: new Date(),
        },
        {
          workflowMode: 'standard',
          success: true,
          outcome: 'completed',
          wasOverridden: false,
          createdAt: new Date(),
        },
      ]),
    );
    const stats = await getLearningStats();
    expect(stats.overrideRate).toBe(0.5);
  });

  test('computes avgAccuracy from the min/max ratio of actual vs estimated duration', async () => {
    workflowLearningRecordFindMany.mockImplementationOnce(() =>
      Promise.resolve([
        {
          workflowMode: 'standard',
          success: true,
          outcome: 'completed',
          wasOverridden: false,
          actualDurationMinutes: 50,
          estimatedDuration: 100,
          createdAt: new Date(),
        },
      ]),
    );
    const stats = await getLearningStats();
    expect(stats.avgAccuracy).toBe(0.5); // min(50,100)/max(50,100)
  });

  test('excludes records without both actual and estimated duration from accuracy', async () => {
    workflowLearningRecordFindMany.mockImplementationOnce(() =>
      Promise.resolve([
        {
          workflowMode: 'standard',
          success: true,
          outcome: 'completed',
          wasOverridden: false,
          actualDurationMinutes: null,
          estimatedDuration: 100,
          createdAt: new Date(),
        },
      ]),
    );
    const stats = await getLearningStats();
    expect(stats.avgAccuracy).toBe(0);
  });

  test('buckets only records from the last 30 days into recentTrend.modeDistribution', async () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const recent = new Date();
    workflowLearningRecordFindMany.mockImplementationOnce(() =>
      Promise.resolve([
        {
          workflowMode: 'standard',
          success: true,
          outcome: 'completed',
          wasOverridden: false,
          createdAt: old,
        },
        {
          workflowMode: 'lightweight',
          success: true,
          outcome: 'completed',
          wasOverridden: false,
          createdAt: recent,
        },
      ]),
    );
    const stats = await getLearningStats();
    expect(stats.recentTrend.period).toBe('30d');
    expect(stats.recentTrend.modeDistribution).toEqual({ lightweight: 1 });
  });
});
