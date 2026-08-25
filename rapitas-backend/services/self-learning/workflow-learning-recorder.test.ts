/**
 * workflow-learning-recorder.test
 *
 * Covers the prediction-resolution chain the execution path depends on. The
 * execution writer knows the outcome but not the prediction, so before this it
 * wrote rows with predictedComplexity null — an outcome with nothing to compare
 * it against (13% filled, measured 2026-08-25).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const readModePrediction = mock(
  (): Promise<Record<string, unknown> | null> => Promise.resolve(null),
);
mock.module('../workflow/learning/mode-prediction', () => ({ readModePrediction }));

const { recordWorkflowExecution, recordExecutionOutcome } =
  await import('./workflow-learning-recorder');

const SNAPSHOT = {
  predictedComplexity: 42,
  workflowMode: 'standard',
  estimatedDurationMinutes: 90,
  thresholds: { min: 36, max: 70 },
  wasOverridden: false,
};

/** Minimal prisma double: one task, capturing learning-record writes. */
function makePrisma(task: Record<string, unknown> | null) {
  const create = mock(() => Promise.resolve({ id: 1 }));
  return {
    create,
    client: {
      task: { findUnique: () => Promise.resolve(task) },
      workflowLearningRecord: { create, findMany: () => Promise.resolve([]) },
    },
  };
}

const TASK = {
  themeId: 1,
  labels: '[]',
  title: 'ledger',
  theme: { categoryId: 5 },
  complexityScore: 17,
  workflowMode: 'lightweight',
};

describe('recordWorkflowExecution prediction resolution', () => {
  beforeEach(() => readModePrediction.mockReset().mockResolvedValue(null));

  test('uses the research snapshot when the caller knows only the outcome', async () => {
    readModePrediction.mockResolvedValue(SNAPSHOT);
    const p = makePrisma(TASK);

    await recordWorkflowExecution(p.client as never, {
      taskId: 658,
      outcome: 'completed',
      actualDurationMinutes: 31,
    });

    const data = (p.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data.predictedComplexity).toBe(42);
    expect(data.workflowMode).toBe('standard');
    expect(data.actualDurationMinutes).toBe(31);
    // The snapshot's estimate is for the whole task; this row's duration is one
    // execution. Carrying it here would invite comparing two different things.
    expect(data.estimatedDuration).toBeNull();
  });

  test('falls back to the task row when no snapshot exists', async () => {
    const p = makePrisma(TASK);

    await recordWorkflowExecution(p.client as never, { taskId: 658, outcome: 'completed' });

    const data = (p.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data.predictedComplexity).toBe(17);
    expect(data.workflowMode).toBe('lightweight');
    // The estimate cannot be reconstructed after the fact, so it stays null
    // rather than being back-filled with a number nobody predicted.
    expect(data.estimatedDuration).toBeNull();
  });

  test('an explicit caller value outranks the snapshot', async () => {
    readModePrediction.mockResolvedValue(SNAPSHOT);
    const p = makePrisma(TASK);

    await recordWorkflowExecution(p.client as never, {
      taskId: 658,
      outcome: 'completed',
      predictedComplexity: 88,
      workflowMode: 'comprehensive',
    });

    const data = (p.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data.predictedComplexity).toBe(88);
    expect(data.workflowMode).toBe('comprehensive');
    expect(readModePrediction).not.toHaveBeenCalled();
  });

  test('records the outcome even when the prediction is unknowable', async () => {
    const p = makePrisma({ ...TASK, complexityScore: null, workflowMode: null });

    await recordWorkflowExecution(p.client as never, { taskId: 658, outcome: 'failed' });

    const data = (p.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data.predictedComplexity).toBeNull();
    expect(data.workflowMode).toBe('standard');
    expect(data.success).toBe(false);
  });
});

describe('recordExecutionOutcome', () => {
  beforeEach(() => readModePrediction.mockReset().mockResolvedValue(SNAPSHOT));

  /** Prisma double that also answers the execution lookup. */
  function makeExecPrisma(execution: Record<string, unknown> | null) {
    const create = mock(() => Promise.resolve({ id: 1 }));
    return {
      create,
      client: {
        agentExecution: { findUnique: () => Promise.resolve(execution) },
        task: { findUnique: () => Promise.resolve(TASK) },
        workflowLearningRecord: { create, findMany: () => Promise.resolve([]) },
      },
    };
  }

  const EXECUTION = {
    executionTimeMs: 8 * 60_000,
    errorMessage: null,
    modelName: 'claude-sonnet-5',
    session: { config: { taskId: 666 } },
  };

  test('records an investigation phase that only ever reached post_processing', async () => {
    const p = makeExecPrisma(EXECUTION);

    await recordExecutionOutcome(p.client as never, 2857, 'completed');

    const data = (p.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data.taskId).toBe(666);
    expect(data.actualDurationMinutes).toBe(8);
    expect(data.predictedComplexity).toBe(42);
    expect(data.outcome).toBe('completed');
  });

  test('writes nothing when the execution has no task behind it', async () => {
    const p = makeExecPrisma({ ...EXECUTION, session: { config: null } });

    await recordExecutionOutcome(p.client as never, 2857, 'completed');

    expect(p.create).not.toHaveBeenCalled();
  });

  test('never throws when the execution row is gone', async () => {
    const p = makeExecPrisma(null);
    expect(await recordExecutionOutcome(p.client as never, 2857, 'failed')).toBeUndefined();
    expect(p.create).not.toHaveBeenCalled();
  });
});
