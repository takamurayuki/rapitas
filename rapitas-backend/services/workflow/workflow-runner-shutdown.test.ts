/**
 * workflow-runner-shutdown.test
 *
 * Verifies that shutdown-caused interruptions in executeWorkflowItem are handled
 * gracefully: the queue item is returned to 'queued' without consuming retry budget,
 * and non-shutdown errors still go through the normal retry/fail path.
 *
 * Also verifies stopProcessing() behaviour: active executions are killed via
 * stopTaskAgents and requeued with the correct error message.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { buildShutdownErrorMessage } from '../agents/orchestrator/shutdown-error';
import { WORKER_SHUTDOWN_ERROR_MESSAGE } from '../../utils/common/shutdown-error';

// --- Mocks (must be declared before module imports) ---

const warnMock = mock((..._args: unknown[]) => {});
const errorMock = mock((..._args: unknown[]) => {});
const loggerMock = { info: () => {}, warn: warnMock, error: errorMock, debug: () => {} };

mock.module('../../config/logger', () => ({
  createLogger: () => loggerMock,
}));

const updateStatusMock = mock((_id: number, _status: string, _opts?: unknown) =>
  Promise.resolve({
    id: _id,
    taskId: 1,
    status: _status,
    currentPhase: 'in_progress',
    priority: 0,
    dependencies: [],
    retryCount: 0,
    maxRetries: 3,
    errorMessage: null,
    queuedAt: new Date(),
    startedAt: null,
    completedAt: null,
    orchestraSessionId: null,
  }),
);
const retryIfPossibleMock = mock((_id: number, _msg?: string) => Promise.resolve(false));
let dequeueSequence: unknown[] = [];

const queueMock = {
  getMaxConcurrency: () => 2,
  dequeue: mock(async () => {
    const next = dequeueSequence.shift();
    return next ?? null;
  }),
  updateStatus: updateStatusMock,
  retryIfPossible: retryIfPossibleMock,
  notifyItemUpdate: () => {},
};

mock.module('./workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => queueMock },
}));

let advanceWorkflowImpl: () => Promise<unknown> = () =>
  Promise.resolve({ success: true, role: 'researcher', status: 'in_progress', skipped: false });

const orchestratorMock = {
  advanceWorkflow: mock((_taskId: number) => advanceWorkflowImpl()),
};

mock.module('./workflow-orchestrator', () => ({
  WorkflowOrchestrator: { getInstance: () => orchestratorMock },
}));

let broadcastDone: (() => void) | undefined;
let broadcastItemUpdateCalls: { event: string; phase: string }[] = [];

const broadcastItemUpdateMock = mock(
  (_itemId: number, _taskId: number, event: string, phase: string) => {
    broadcastItemUpdateCalls.push({ event, phase });
    if (event === 'execution_error') {
      broadcastDone?.();
    }
  },
);

mock.module('./workflow-runner-events', () => ({
  logPhaseTransition: () => Promise.resolve(),
  broadcastRunnerStatus: () => {},
  broadcastItemUpdate: broadcastItemUpdateMock,
}));

const taskRow = {
  id: 1,
  workflowStatus: 'in_progress',
  status: 'in-progress',
  parentId: null,
};

const prismaMock = {
  task: { findUnique: mock(() => Promise.resolve(taskRow)) },
};

mock.module('../../config', () => ({
  prisma: prismaMock,
  getProjectRoot: () => '/tmp/rapitas-test',
  createLogger: () => loggerMock,
  ensureDatabaseConnection: () => Promise.resolve(),
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => 'default',
}));

// NOTE: execution-timeouts getPhaseTimeoutMs returns 30min by default; keep it short in tests.
mock.module('../agents/execution-timeouts', () => ({
  DEFAULT_PHASE_TIMEOUT_MS: 5000,
  getPhaseTimeoutMs: () => 5000, // 5s timeout so tests don't stall
  getWorkflowLockTtlMs: () => 10000,
  getAgentTimeoutMs: () => 4000,
}));

// Top-level spy for stopTaskAgents — registered before workflow-runner import so that
// both dynamic import paths (stopProcessing L93 and non-shutdown catch L401) share the same spy.
const stopTaskAgentsMock = mock(
  (_taskId: number, _opts?: unknown) =>
    Promise.resolve({ stoppedCount: 0, executionIds: [] as string[] }),
);

mock.module('../agents/stop-task-agents', () => ({
  stopTaskAgents: stopTaskAgentsMock,
}));

// Dynamically import AFTER all mock.module() calls so the class picks up mocks.
const { WorkflowRunner } = await import('./workflow-runner');

// Reset the singleton so each test gets a fresh instance bound to the mocked deps.
function resetRunner() {
  (WorkflowRunner as unknown as { instance: unknown }).instance = undefined;
}

function resetMocks() {
  warnMock.mockClear();
  errorMock.mockClear();
  updateStatusMock.mockClear();
  retryIfPossibleMock.mockClear();
  stopTaskAgentsMock.mockClear();
  broadcastItemUpdateCalls = [];
  broadcastDone = undefined;
  orchestratorMock.advanceWorkflow.mockClear();
  dequeueSequence = [];
}

/** Returns a promise that resolves once broadcastItemUpdate('execution_error') fires (or times out). */
function waitForExecutionError(timeoutMs = 3000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    broadcastDone = resolve;
    setTimeout(
      () =>
        reject(
          new Error(`broadcastItemUpdate('execution_error') not called within ${timeoutMs}ms`),
        ),
      timeoutMs,
    );
  });
}

/**
 * Polls predicate until it returns true or timeoutMs elapses.
 *
 * @param predicate - Condition to wait for / 待機条件
 * @param timeoutMs - Max wait time in ms / 最大待機時間(ms)
 */
async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

const QUEUE_ITEM = {
  id: 10,
  taskId: 1,
  orchestraSessionId: null,
  priority: 0,
  status: 'running',
  currentPhase: 'in_progress',
  dependencies: [] as number[],
  retryCount: 0,
  maxRetries: 3,
  errorMessage: null,
  queuedAt: new Date(),
  startedAt: new Date(),
  completedAt: null,
};

// ──────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────

describe('WorkflowRunner catch block — shutdown handling', () => {
  beforeEach(() => {
    resetMocks();
    resetRunner();
  });

  test('shutdown error → WARN logged (not ERROR), updateStatus("queued") called, retryIfPossible NOT called', async () => {
    // advanceWorkflow throws a shutdown error (mirrors task-executor behaviour)
    advanceWorkflowImpl = () =>
      Promise.reject(new Error(buildShutdownErrorMessage('start new execution')));

    dequeueSequence = [QUEUE_ITEM, null]; // one item, then stop

    const runner = WorkflowRunner.getInstance();
    const done = waitForExecutionError();
    runner.startProcessing(60_000); // long interval so only the immediate processQueue fires

    await done;
    await runner.stopProcessing();

    // WARN must have been called (not ERROR)
    const warnCalls = warnMock.mock.calls.map((c) => String(c[0]));
    expect(warnCalls.some((m) => m.includes('interrupted by shutdown'))).toBe(true);

    const errorCalls = errorMock.mock.calls.map((c) =>
      typeof c[0] === 'string' ? c[0] : JSON.stringify(c[0]),
    );
    // ERROR must NOT contain a runner execution-error line for the shutdown
    expect(errorCalls.some((m) => m.includes('Execution error for task'))).toBe(false);

    // updateStatus('queued') must have been called
    const queuedCall = updateStatusMock.mock.calls.find(
      (args) =>
        args[1] === 'queued' &&
        typeof args[2] === 'object' &&
        args[2] !== null &&
        'errorMessage' in (args[2] as Record<string, unknown>) &&
        (args[2] as Record<string, unknown>)['errorMessage'] === 'Shutdown - returned to queue',
    );
    expect(queuedCall).toBeDefined();

    // retryIfPossible must NOT have been called
    expect(retryIfPossibleMock.mock.calls.length).toBe(0);
  });

  test('non-shutdown error → ERROR logged, retryIfPossible called, updateStatus("queued") NOT called for shutdown', async () => {
    advanceWorkflowImpl = () => Promise.reject(new Error('Some database connection error'));

    dequeueSequence = [QUEUE_ITEM, null];

    const runner = WorkflowRunner.getInstance();
    const done = waitForExecutionError();
    runner.startProcessing(60_000);

    await done;
    await runner.stopProcessing();

    // ERROR must have been logged
    const errorCalls = errorMock.mock.calls.map((c) =>
      typeof c[0] === 'string' ? c[0] : JSON.stringify(c[0]),
    );
    expect(errorCalls.some((m) => m.includes('Execution error for task'))).toBe(true);

    // retryIfPossible must have been called
    expect(retryIfPossibleMock.mock.calls.length).toBeGreaterThan(0);

    // updateStatus('queued') with shutdown message must NOT have been called
    const shutdownQueuedCall = updateStatusMock.mock.calls.find(
      (args) =>
        args[1] === 'queued' &&
        typeof args[2] === 'object' &&
        args[2] !== null &&
        'errorMessage' in (args[2] as Record<string, unknown>) &&
        (args[2] as Record<string, unknown>)['errorMessage'] === 'Shutdown - returned to queue',
    );
    expect(shutdownQueuedCall).toBeUndefined();
  });

  test('stopProcessing() with active execution — stopTaskAgents kill called, updateStatus queued with runner message, activeItems=0', async () => {
    // NOTE: never-resolving keeps the item in activeExecutions while we call stopProcessing.
    advanceWorkflowImpl = () => new Promise(() => {});

    dequeueSequence = [QUEUE_ITEM, null];

    const runner = WorkflowRunner.getInstance();
    runner.startProcessing(60_000);

    // Wait until activeExecutions.set() has completed so the item is observable.
    await waitUntil(() => runner.getStatus().activeItems > 0);

    await runner.stopProcessing();

    // stopTaskAgents must be called with the kill error message (L96 in workflow-runner.ts)
    const killCall = stopTaskAgentsMock.mock.calls.find(
      (args) =>
        args[0] === QUEUE_ITEM.taskId &&
        typeof args[1] === 'object' &&
        args[1] !== null &&
        (args[1] as Record<string, unknown>)['errorMessage'] === 'Runner shutdown',
    );
    expect(killCall).toBeDefined();

    // updateStatus('queued') must be called with the runner-specific requeue message (L100-102)
    // NOTE: distinct from the catch-path message 'Shutdown - returned to queue'
    const requeueCall = updateStatusMock.mock.calls.find(
      (args) =>
        args[0] === QUEUE_ITEM.id &&
        args[1] === 'queued' &&
        typeof args[2] === 'object' &&
        args[2] !== null &&
        (args[2] as Record<string, unknown>)['errorMessage'] === 'Runner shutdown - returned to queue',
    );
    expect(requeueCall).toBeDefined();

    // activeExecutions must be cleared after stopProcessing completes
    expect(runner.getStatus().activeItems).toBe(0);
  });

  test('non-shutdown error catch path — stopTaskAgents called with Phase failed message', async () => {
    advanceWorkflowImpl = () => Promise.reject(new Error('Some database connection error'));

    dequeueSequence = [QUEUE_ITEM, null];

    const runner = WorkflowRunner.getInstance();
    const done = waitForExecutionError();
    runner.startProcessing(60_000);

    await done;
    await runner.stopProcessing();

    // stopTaskAgents must be called with 'Phase failed: ...' (L401-402 in workflow-runner.ts)
    const killCall = stopTaskAgentsMock.mock.calls.find(
      (args) =>
        args[0] === QUEUE_ITEM.taskId &&
        typeof args[1] === 'object' &&
        args[1] !== null &&
        typeof (args[1] as Record<string, unknown>)['errorMessage'] === 'string' &&
        ((args[1] as Record<string, unknown>)['errorMessage'] as string).startsWith('Phase failed'),
    );
    expect(killCall).toBeDefined();
  });

  test('Worker-layer shutdown error (WORKER_SHUTDOWN_ERROR_MESSAGE) → WARN logged, updateStatus("queued"), retryIfPossible NOT called', async () => {
    // NOTE: WORKER_SHUTDOWN_ERROR_MESSAGE ('Manager is shutting down') uses exact-match detection
    // in isShutdownError — different from the prefix-based SHUTDOWN_ERROR_MESSAGE path tested in Test 1.
    advanceWorkflowImpl = () => Promise.reject(new Error(WORKER_SHUTDOWN_ERROR_MESSAGE));

    dequeueSequence = [QUEUE_ITEM, null];

    const runner = WorkflowRunner.getInstance();
    const done = waitForExecutionError();
    runner.startProcessing(60_000);

    await done;
    await runner.stopProcessing();

    // WARN must have been called (not ERROR)
    const warnCalls = warnMock.mock.calls.map((c) => String(c[0]));
    expect(warnCalls.some((m) => m.includes('interrupted by shutdown'))).toBe(true);

    const errorCalls = errorMock.mock.calls.map((c) =>
      typeof c[0] === 'string' ? c[0] : JSON.stringify(c[0]),
    );
    // ERROR must NOT contain a runner execution-error line for the shutdown
    expect(errorCalls.some((m) => m.includes('Execution error for task'))).toBe(false);

    // updateStatus('queued') must have been called with the catch-path requeue message
    const queuedCall = updateStatusMock.mock.calls.find(
      (args) =>
        args[1] === 'queued' &&
        typeof args[2] === 'object' &&
        args[2] !== null &&
        'errorMessage' in (args[2] as Record<string, unknown>) &&
        (args[2] as Record<string, unknown>)['errorMessage'] === 'Shutdown - returned to queue',
    );
    expect(queuedCall).toBeDefined();

    // retryIfPossible must NOT have been called (retry budget not consumed on shutdown)
    expect(retryIfPossibleMock.mock.calls.length).toBe(0);
  });
});
