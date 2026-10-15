/**
 * workflow-runner.stale-active.test
 *
 * task 1165: a queue item cancelled in the DB (periodic sweep / reconciler) must
 * not keep its activeExecutions slot, otherwise processQueue never dequeues.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { QueueItem } from './workflow-queue';
import type { WorkflowAdvanceResult } from './workflow-types';
import type { TaskWorkflowState } from '../task/task-resolver';

const errorMock = mock((..._a: unknown[]) => {});
const warnMock = mock((..._a: unknown[]) => {});
const infoMock = mock((..._a: unknown[]) => {});
const loggerMock = { info: infoMock, warn: warnMock, error: errorMock, debug: () => {} };

mock.module('../../config/logger', () => ({
  createLogger: () => loggerMock,
  logger: loggerMock,
  getBackendLogFilePath: () => '/tmp/fake-backend.log',
}));

const findManyMock = mock((_args: unknown): Promise<{ id: number }[]> => Promise.resolve([]));

mock.module('../../config', () => ({
  prisma: {
    task: {
      findUnique: mock(() => Promise.resolve(null)),
      update: mock(() => Promise.resolve({})),
    },
    userSettings: { findFirst: mock(() => Promise.resolve(null)) },
    workflowQueueItem: { findMany: findManyMock },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
  logger: loggerMock,
  createLogger: () => loggerMock,
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => 'default',
  getProjectRoot: () => '/tmp/rapitas-test',
}));

const taskRow: TaskWorkflowState = {
  id: 9,
  status: 'in-progress',
  workflowStatus: 'in_progress',
  workflowMode: null,
  parentId: null,
};

mock.module('../task/task-resolver', () => ({
  resolveTaskWorkflowState: mock(() => Promise.resolve(taskRow)),
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
  taskRowConfirmedAbsent: mock(() => Promise.resolve(false)),
}));

let dequeueSequence: QueueItem[] = [];
const dequeueMock = mock(async (): Promise<QueueItem | null> => dequeueSequence.shift() ?? null);
const queueMock = {
  getMaxConcurrency: () => 1,
  dequeue: dequeueMock,
  updateStatus: mock(() => Promise.resolve({})),
  retryIfPossible: mock(() => Promise.resolve(false)),
  findByTaskId: mock(() => Promise.resolve(null)),
  notifyItemUpdate: () => {},
};

mock.module('./workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => queueMock },
}));

const advanceWorkflowMock = mock(
  (_taskId: number): Promise<WorkflowAdvanceResult> => new Promise(() => {}),
);

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

mock.module('../agents/stop-task-agents', () => ({
  stopTaskAgents: mock(() => Promise.resolve({ stoppedCount: 0, executionIds: [] })),
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

type Runner = InstanceType<typeof WorkflowRunner>;
type ActiveMap = Map<
  number,
  {
    queueItemId: number;
    taskId: number;
    startedAt: Date;
    currentPhase: string;
    abortController: AbortController;
  }
>;

function activeOf(runner: Runner): ActiveMap {
  return (runner as unknown as { activeExecutions: ActiveMap }).activeExecutions;
}

function seed(runner: Runner, id: number, ageMs: number): AbortController {
  const abortController = new AbortController();
  activeOf(runner).set(id, {
    queueItemId: id,
    taskId: id + 1000,
    startedAt: new Date(Date.now() - ageMs),
    currentPhase: 'in_progress',
    abortController,
  });
  return abortController;
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

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`waitUntil: not met within ${timeoutMs}ms`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 60));

describe('WorkflowRunner — stale activeExecutions self-heal (task 1165)', () => {
  beforeEach(() => {
    (WorkflowRunner as unknown as { instance: unknown }).instance = undefined;
    warnMock.mockClear();
    dequeueMock.mockClear();
    findManyMock.mockReset().mockResolvedValue([]);
    dequeueSequence = [];
  });

  test('releaseQueueItem removes only the matching entry without aborting it (AC1)', () => {
    const runner = WorkflowRunner.getInstance();
    const ac = seed(runner, 4168, 1000);
    seed(runner, 4169, 1000);

    expect(runner.releaseQueueItem(4168)).toBe(true);
    expect(ac.signal.aborted).toBe(false); // abort would let the worker overwrite the cancelled row
    expect([...activeOf(runner).keys()]).toEqual([4169]);
    expect(runner.releaseQueueItem(4168)).toBe(false);
  });

  test('DB 0 running x memory 1: entry dropped with WARN and dequeue resumes (AC2)', async () => {
    const runner = WorkflowRunner.getInstance();
    seed(runner, 4168, 5 * 60_000);
    dequeueSequence = [queueItem(4170, 1159)];

    runner.startProcessing(60_000);
    await waitUntil(() => activeOf(runner).has(4170));

    expect(activeOf(runner).has(4168)).toBe(false);
    expect(dequeueMock).toHaveBeenCalled();
    expect(warnMock.mock.calls.some((c) => String(c[1]).includes('self-heal'))).toBe(true);
    await runner.stopProcessing();
  });

  test('a running DB item keeps its entry and blocks dequeue (AC3)', async () => {
    const runner = WorkflowRunner.getInstance();
    findManyMock.mockResolvedValue([{ id: 4168 }]);
    seed(runner, 4168, 5 * 60_000);
    dequeueSequence = [queueItem(4170, 1159)];

    runner.startProcessing(60_000);
    await settle();

    expect(activeOf(runner).has(4168)).toBe(true);
    expect(dequeueMock).not.toHaveBeenCalled();
    await runner.stopProcessing();
  });

  test('a fresh entry with no running DB row is dropped immediately (no grace)', async () => {
    const runner = WorkflowRunner.getInstance();
    seed(runner, 4168, 10);
    dequeueSequence = [queueItem(4170, 1159)];

    runner.startProcessing(60_000);
    await waitUntil(() => activeOf(runner).has(4170));

    expect(activeOf(runner).has(4168)).toBe(false);
    await runner.stopProcessing();
  });

  test('with mixed entries only the one without a running DB row is dropped (AC3)', async () => {
    const runner = WorkflowRunner.getInstance();
    findManyMock.mockResolvedValue([{ id: 4169 }]);
    seed(runner, 4168, 5 * 60_000);
    seed(runner, 4169, 5 * 60_000);

    runner.startProcessing(60_000);
    await settle();

    expect([...activeOf(runner).keys()]).toEqual([4169]);
    expect(dequeueMock).not.toHaveBeenCalled(); // 4169 still occupies the single slot
    await runner.stopProcessing();
  });

  test('a DB error keeps the entries (fail-open)', async () => {
    const runner = WorkflowRunner.getInstance();
    findManyMock.mockRejectedValue(new Error('db down'));
    seed(runner, 4168, 5 * 60_000);

    runner.startProcessing(60_000);
    await settle();

    expect(activeOf(runner).has(4168)).toBe(true);
    await runner.stopProcessing();
  });
});
