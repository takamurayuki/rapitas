/**
 * workflow-runner.errors.test
 *
 * Covers WorkflowRunner error paths not already exercised by
 * workflow-runner-shutdown.test.ts (which covers the shutdown-vs-non-shutdown
 * classification in the catch block): terminal-failure propagation to a subtask's
 * parent, processQueue's concurrency-limited dequeue loop, and processQueue
 * swallowing a dequeue error instead of crashing the poll cycle.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { QueueItem } from './workflow-queue';
import type { WorkflowAdvanceResult } from './workflow-types';
import type { TaskWorkflowState } from '../task/task-resolver';

const errorMock = mock((..._a: unknown[]) => {});
const loggerMock = { info: () => {}, warn: () => {}, error: errorMock, debug: () => {} };

mock.module('../../config/logger', () => ({
  createLogger: () => loggerMock,
  logger: loggerMock,
  getBackendLogFilePath: () => '/tmp/fake-backend.log',
}));

const taskUpdateMock = mock((_args: { where: { id: number }; data: Record<string, unknown> }) =>
  Promise.resolve({}),
);

mock.module('../../config', () => ({
  prisma: {
    task: { findUnique: mock(() => Promise.resolve(null)), update: taskUpdateMock },
    userSettings: { findFirst: mock(() => Promise.resolve(null)) },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
  logger: loggerMock,
  createLogger: () => loggerMock,
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => 'default',
  getProjectRoot: () => '/tmp/rapitas-test',
}));

let taskRow: TaskWorkflowState = {
  id: 9,
  status: 'in-progress',
  workflowStatus: 'in_progress',
  workflowMode: null,
  parentId: 77,
};
const resolveTaskWorkflowStateMock = mock((): Promise<TaskWorkflowState | null> =>
  Promise.resolve(taskRow),
);

mock.module('../task/task-resolver', () => ({
  resolveTaskWorkflowState: resolveTaskWorkflowStateMock,
  resolveTaskForPlanApproval: mock(() => Promise.resolve(null)),
  resolveTaskWithTheme: mock(() => Promise.resolve(null)),
  resolveTaskWithThemeAndCategory: mock(() => Promise.resolve(null)),
  resolveTaskForExecution: mock(() => Promise.resolve(null)),
  resolveTaskWorkingDirectory: mock(() => Promise.resolve(null)),
  resolveTaskTitle: mock(() => Promise.resolve(null)),
  resolveTaskThemeId: mock(() => Promise.resolve(null)),
  resolveTaskForComplexityAnalysis: mock(() => Promise.resolve(null)),
  resolveTaskSubtaskInfo: mock(() => Promise.resolve(null)),
  resolveTaskForAutoMerge: mock(() => Promise.resolve(null)),
  resolveTaskForLearning: mock(() => Promise.resolve(null)),
}));

let dequeueSequence: (QueueItem | Error)[] = [];
const dequeueMock = mock(async (): Promise<QueueItem | null> => {
  const next = dequeueSequence.shift();
  if (next === undefined) return null;
  if (next instanceof Error) throw next;
  return next;
});
const updateStatusMock = mock(
  (
    id: number,
    status: string,
    extra?: { currentPhase?: string; errorMessage?: string; result?: string },
  ) =>
    Promise.resolve({
      id,
      taskId: 1,
      status,
      currentPhase: extra?.currentPhase ?? 'in_progress',
      priority: 0,
      dependencies: [],
      retryCount: 0,
      maxRetries: 3,
      errorMessage: extra?.errorMessage ?? null,
      queuedAt: new Date(),
      startedAt: null,
      completedAt: null,
      orchestraSessionId: null,
    }),
);
const retryIfPossibleMock = mock(() => Promise.resolve(false));
let maxConcurrency = 2;

const queueMock = {
  getMaxConcurrency: () => maxConcurrency,
  dequeue: dequeueMock,
  updateStatus: updateStatusMock,
  retryIfPossible: retryIfPossibleMock,
  findByTaskId: mock(() => Promise.resolve(null)),
  notifyItemUpdate: () => {},
};

mock.module('./workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => queueMock },
}));

let advanceWorkflowImpl: (taskId: number) => Promise<WorkflowAdvanceResult> = () =>
  new Promise(() => {});
const advanceWorkflowMock = mock((taskId: number) => advanceWorkflowImpl(taskId));

mock.module('./workflow-orchestrator', () => ({
  WorkflowOrchestrator: { getInstance: () => ({ advanceWorkflow: advanceWorkflowMock }) },
  resolveWorkflowDir: mock(() => ''),
  readWorkflowFile: mock(() => Promise.resolve(null)),
  writeWorkflowFile: mock(() => Promise.resolve()),
  buildRoleContext: mock(() => ({})),
  callAnthropicAPI: mock(() => Promise.resolve('')),
  callOpenAIAPI: mock(() => Promise.resolve('')),
  decryptApiKey: mock(() => ''),
  resolveSystemPromptContent: mock(() => Promise.resolve('')),
}));

// A rejecting advanceWorkflow leaves a brief unhandled-rejection window between
// creating executionPromise and Promise.race attaching its handler (the code
// awaits a dynamic import in between). Mocking this module (vs. real
// filesystem-backed resolution) keeps that window short and deterministic.
mock.module('../agents/execution-timeouts', () => ({
  DEFAULT_PHASE_TIMEOUT_MS: 30 * 60 * 1000,
  getPhaseTimeoutMs: () => 5000,
  getWorkflowLockTtlMs: () => 10000,
  getAgentTimeoutMs: () => 4000,
}));

mock.module('./workflow-runner-events', () => ({
  logPhaseTransition: mock(() => Promise.resolve()),
  broadcastRunnerStatus: mock(() => {}),
  broadcastItemUpdate: mock(() => {}),
}));

const stopTaskAgentsMock = mock(() => Promise.resolve({ stoppedCount: 0, executionIds: [] }));

mock.module('../agents/stop-task-agents', () => ({
  stopTaskAgents: stopTaskAgentsMock,
  stopThemeAgents: mock(() => Promise.resolve({ stoppedCount: 0, executionIds: [] })),
}));

const onSubtaskCompletedMock = mock(() => Promise.resolve());

mock.module('./subtask-completion-handler', () => ({
  onSubtaskCompleted: onSubtaskCompletedMock,
  isSubtaskFinished: () => true,
  isSubtaskFailed: () => false,
  isSubtaskPassed: () => true,
  isParentFinalizable: () => true,
}));

const { WorkflowRunner } = await import('./workflow-runner');

function resetRunner(): void {
  (WorkflowRunner as unknown as { instance: unknown }).instance = undefined;
}

function resetMocks(): void {
  errorMock.mockClear();
  taskUpdateMock.mockClear();
  updateStatusMock.mockClear();
  retryIfPossibleMock.mockClear();
  dequeueMock.mockClear();
  advanceWorkflowMock.mockClear();
  stopTaskAgentsMock.mockClear();
  onSubtaskCompletedMock.mockClear();
  resolveTaskWorkflowStateMock.mockClear();
  dequeueSequence = [];
  maxConcurrency = 2;
  advanceWorkflowImpl = () => new Promise(() => {});
  taskRow = {
    id: 9,
    status: 'in-progress',
    workflowStatus: 'in_progress',
    workflowMode: null,
    parentId: 77,
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`waitUntil: not met within ${timeoutMs}ms`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

function queueItem(id: number, taskId: number): QueueItem {
  return {
    id,
    taskId,
    orchestraSessionId: null,
    priority: 0,
    status: 'running',
    currentPhase: 'in_progress',
    dependencies: [],
    retryCount: 0,
    maxRetries: 3,
    errorMessage: null,
    queuedAt: new Date(),
    startedAt: new Date(),
    completedAt: null,
  };
}

describe('WorkflowRunner — terminal failure propagation', () => {
  beforeEach(() => {
    resetMocks();
    resetRunner();
  });

  test('a subtask that exhausts its retry budget is marked failed and its parent notified', async () => {
    advanceWorkflowImpl = () => Promise.reject(new Error('agent crashed hard'));
    retryIfPossibleMock.mockResolvedValueOnce(false);
    const item = queueItem(50, taskRow.id);

    const runner = WorkflowRunner.getInstance();
    dequeueSequence = [item];
    runner.startProcessing(60_000);
    // A short head start: all deps resolve instantly, so the whole pass can finish
    // inside one microtask burst — polling for activeItems===0 too early would
    // race stopProcessing() against the item registering (see other *.test.ts files).
    await new Promise((resolve) => setTimeout(resolve, 20));
    await waitUntil(() => runner.getStatus().activeItems === 0);
    await runner.stopProcessing();

    expect(updateStatusMock).toHaveBeenCalledWith(item.id, 'failed', {
      errorMessage: 'agent crashed hard',
    });
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: taskRow.id },
      data: { status: 'failed', completedAt: expect.any(Date) },
    });
    expect(onSubtaskCompletedMock).toHaveBeenCalledWith(taskRow.id);
  });

  test('a non-subtask terminal failure does not touch task.status or the parent hook', async () => {
    taskRow = { ...taskRow, parentId: null };
    advanceWorkflowImpl = () => Promise.reject(new Error('boom'));
    retryIfPossibleMock.mockResolvedValueOnce(false);
    const item = queueItem(51, taskRow.id);

    const runner = WorkflowRunner.getInstance();
    dequeueSequence = [item];
    runner.startProcessing(60_000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await waitUntil(() => runner.getStatus().activeItems === 0);
    await runner.stopProcessing();

    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(onSubtaskCompletedMock).not.toHaveBeenCalled();
  });
});

describe('WorkflowRunner — processQueue dequeue loop', () => {
  beforeEach(() => {
    resetMocks();
    resetRunner();
  });

  test('stops dequeuing once activeExecutions reaches maxConcurrency', async () => {
    maxConcurrency = 2;
    const itemA = queueItem(60, 1);
    const itemB = queueItem(61, 2);
    const itemC = queueItem(62, 3);
    dequeueSequence = [itemA, itemB, itemC];

    const runner = WorkflowRunner.getInstance();
    runner.startProcessing(60_000);
    await waitUntil(() => runner.getStatus().activeItems === 2);

    // The 3rd candidate must be left in the queue — only 2 dequeue calls consumed.
    expect(dequeueSequence).toEqual([itemC]);
    expect(dequeueMock).toHaveBeenCalledTimes(2);

    await runner.stopProcessing();
  });

  test('a dequeue error is logged and does not start any execution', async () => {
    dequeueSequence = [new Error('db connection lost')];

    const runner = WorkflowRunner.getInstance();
    runner.startProcessing(60_000);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(runner.getStatus().activeItems).toBe(0);
    expect(
      errorMock.mock.calls.some((c) => {
        const obj = c[0] as { err?: unknown } | undefined;
        return obj?.err instanceof Error && obj.err.message === 'db connection lost';
      }),
    ).toBe(true);

    await runner.stopProcessing();
  });
});
