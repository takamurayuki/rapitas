/**
 * workflow-runner.test
 *
 * Covers WorkflowRunner's lifecycle surface: singleton access, start/stop
 * idempotency, abortTask targeting, getStatus snapshot, and resumeAfterApproval.
 * Phase-transition decision logic (completed / verify_done / plan_created /
 * advancing) is covered in the sibling *.phases / *.advancing / *.verify-settle
 * test files; error/retry paths in *.errors.test.ts.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { QueueItem } from './workflow-queue';
import type { WorkflowAdvanceResult } from './workflow-types';
import type { TaskWorkflowState } from '../task/task-resolver';

const warnMock = mock((..._a: unknown[]) => {});
const errorMock = mock((..._a: unknown[]) => {});
const infoMock = mock((..._a: unknown[]) => {});
const loggerMock = { info: infoMock, warn: warnMock, error: errorMock, debug: () => {} };

mock.module('../../config/logger', () => ({
  createLogger: () => loggerMock,
  logger: loggerMock,
  getBackendLogFilePath: () => '/tmp/fake-backend.log',
}));

const prismaMock = {
  task: {
    findUnique: mock(() => Promise.resolve(null)),
    update: mock(() => Promise.resolve({})),
  },
  userSettings: { findFirst: mock(() => Promise.resolve(null)) },
};

mock.module('../../config', () => ({
  prisma: prismaMock,
  ensureDatabaseConnection: () => Promise.resolve(),
  logger: loggerMock,
  createLogger: () => loggerMock,
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => 'default',
  getProjectRoot: () => '/tmp/rapitas-test',
}));

let resolveWorkflowStateImpl: (taskId: number) => Promise<TaskWorkflowState | null> = () =>
  Promise.resolve(null);
const resolveTaskWorkflowStateMock = mock((taskId: number) => resolveWorkflowStateImpl(taskId));

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

let dequeueSequence: QueueItem[] = [];
const dequeueMock = mock(async (): Promise<QueueItem | null> => dequeueSequence.shift() ?? null);
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
let findByTaskIdImpl: (taskId: number) => Promise<QueueItem | null> = () => Promise.resolve(null);
const findByTaskIdMock = mock((taskId: number) => findByTaskIdImpl(taskId));

const queueMock = {
  getMaxConcurrency: () => 2,
  dequeue: dequeueMock,
  updateStatus: updateStatusMock,
  retryIfPossible: retryIfPossibleMock,
  findByTaskId: findByTaskIdMock,
  notifyItemUpdate: () => {},
};

mock.module('./workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => queueMock },
}));

let advanceWorkflowImpl: (taskId: number) => Promise<WorkflowAdvanceResult> = () =>
  Promise.resolve({ success: true, role: 'researcher', status: 'in_progress', skipped: false });
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

const broadcastItemUpdateMock = mock((..._a: unknown[]) => {});
const broadcastRunnerStatusMock = mock((..._a: unknown[]) => {});

mock.module('./workflow-runner-events', () => ({
  logPhaseTransition: mock(() => Promise.resolve()),
  broadcastRunnerStatus: broadcastRunnerStatusMock,
  broadcastItemUpdate: broadcastItemUpdateMock,
}));

const stopTaskAgentsMock = mock(() => Promise.resolve({ stoppedCount: 0, executionIds: [] }));

mock.module('../agents/stop-task-agents', () => ({
  stopTaskAgents: stopTaskAgentsMock,
  stopThemeAgents: mock(() => Promise.resolve({ stoppedCount: 0, executionIds: [] })),
}));

mock.module('./subtask-completion-handler', () => ({
  onSubtaskCompleted: mock(() => Promise.resolve()),
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
  warnMock.mockClear();
  errorMock.mockClear();
  infoMock.mockClear();
  updateStatusMock.mockClear();
  retryIfPossibleMock.mockClear();
  findByTaskIdMock.mockClear();
  advanceWorkflowMock.mockClear();
  broadcastItemUpdateMock.mockClear();
  broadcastRunnerStatusMock.mockClear();
  stopTaskAgentsMock.mockClear();
  dequeueSequence = [];
  resolveWorkflowStateImpl = () => Promise.resolve(null);
  findByTaskIdImpl = () => Promise.resolve(null);
  advanceWorkflowImpl = () =>
    Promise.resolve({ success: true, role: 'researcher', status: 'in_progress', skipped: false });
}

/** Polls until predicate is true or timeoutMs elapses. */
async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`waitUntil: not met within ${timeoutMs}ms`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

const QUEUE_ITEM: QueueItem = {
  id: 10,
  taskId: 1,
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

describe('WorkflowRunner — singleton + status', () => {
  beforeEach(() => {
    resetMocks();
    resetRunner();
  });

  test('getInstance returns the same instance on repeated calls', () => {
    const a = WorkflowRunner.getInstance();
    const b = WorkflowRunner.getInstance();
    expect(a).toBe(b);
  });

  test('getStatus reflects running flag and configured poll interval', () => {
    const runner = WorkflowRunner.getInstance();
    expect(runner.getStatus()).toMatchObject({
      isRunning: false,
      activeItems: 0,
      processedTotal: 0,
    });
    runner.startProcessing(45_000);
    expect(runner.getStatus()).toMatchObject({ isRunning: true, pollIntervalMs: 45_000 });
  });

  test('startProcessing called twice warns and does not double-broadcast start', async () => {
    const runner = WorkflowRunner.getInstance();
    runner.startProcessing(60_000);
    runner.startProcessing(60_000);
    expect(warnMock.mock.calls.some((c) => String(c[0]).includes('Already running'))).toBe(true);
    expect(broadcastRunnerStatusMock).toHaveBeenCalledTimes(1);
    await runner.stopProcessing();
  });

  test('stopProcessing on a non-running instance is a no-op', async () => {
    const runner = WorkflowRunner.getInstance();
    await runner.stopProcessing();
    expect(stopTaskAgentsMock).not.toHaveBeenCalled();
    expect(broadcastRunnerStatusMock).not.toHaveBeenCalled();
  });
});

describe('WorkflowRunner — abortTask', () => {
  beforeEach(() => {
    resetMocks();
    resetRunner();
  });

  test('returns 0 when there is no active execution for the task', () => {
    const runner = WorkflowRunner.getInstance();
    expect(runner.abortTask(999)).toBe(0);
  });

  test('aborts the matching in-flight execution and is idempotent on a 2nd call', async () => {
    // Never-resolving advanceWorkflow keeps the item active so abortTask has something to abort.
    advanceWorkflowImpl = () => new Promise(() => {});
    resolveWorkflowStateImpl = () =>
      Promise.resolve({
        id: 1,
        status: 'in-progress',
        workflowStatus: 'in_progress',
        workflowMode: null,
        parentId: null,
      });
    dequeueSequence = [QUEUE_ITEM, null];

    const runner = WorkflowRunner.getInstance();
    runner.startProcessing(60_000);
    await waitUntil(() => runner.getStatus().activeItems > 0);

    expect(runner.abortTask(QUEUE_ITEM.taskId)).toBe(1);
    // Already aborted — a 2nd call must not double-count.
    expect(runner.abortTask(QUEUE_ITEM.taskId)).toBe(0);

    await runner.stopProcessing();
  });
});

describe('WorkflowRunner — resumeAfterApproval', () => {
  beforeEach(() => {
    resetMocks();
    resetRunner();
  });

  test('returns false when no queue item exists for the task', async () => {
    findByTaskIdImpl = () => Promise.resolve(null);
    const runner = WorkflowRunner.getInstance();
    const result = await runner.resumeAfterApproval(42);
    expect(result).toBe(false);
    expect(updateStatusMock).not.toHaveBeenCalled();
  });

  test('returns false when the item is not in waiting_approval status', async () => {
    findByTaskIdImpl = () => Promise.resolve({ ...QUEUE_ITEM, status: 'running' });
    const runner = WorkflowRunner.getInstance();
    const result = await runner.resumeAfterApproval(QUEUE_ITEM.taskId);
    expect(result).toBe(false);
    expect(updateStatusMock).not.toHaveBeenCalled();
  });

  test('requeues a waiting_approval item and returns true', async () => {
    findByTaskIdImpl = () => Promise.resolve({ ...QUEUE_ITEM, status: 'waiting_approval' });
    const runner = WorkflowRunner.getInstance();
    const result = await runner.resumeAfterApproval(QUEUE_ITEM.taskId);
    expect(result).toBe(true);
    expect(updateStatusMock).toHaveBeenCalledWith(QUEUE_ITEM.id, 'queued', {
      currentPhase: 'plan_approved',
    });
  });
});
