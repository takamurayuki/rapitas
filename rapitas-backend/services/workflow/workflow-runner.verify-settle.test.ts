/**
 * workflow-runner.verify-settle.test
 *
 * Covers the `verify_done` grace-window branch of WorkflowRunner.executeWorkflowItem
 * (waitForVerifyCompletion): the async commit/PR/merge automation may still be
 * settling when the runner polls, so `verify_done` alone must not be reported as a
 * failure. Exercises all four outcomes: completed, moved (bounced to another
 * phase, e.g. self-repair), aborted (stop landed during the grace window — not a
 * failure), and stuck (genuinely still verify_done after the grace window).
 *
 * RAPITAS_VERIFY_SETTLE_MS is set BELOW the module's default (60s) so the
 * deterministic "stuck" case doesn't need a 60s wait; the poll interval itself
 * (2s, hardcoded in the source) is not overridable, so the "stuck" test still
 * costs one real ~2s wait.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { QueueItem } from './workflow-queue';
import type { WorkflowAdvanceResult } from './workflow-types';
import type { TaskWorkflowState } from '../task/task-resolver';

process.env.RAPITAS_VERIFY_SETTLE_MS = '1000';

const loggerMock = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

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

// Sticky-last (not shift): the "stuck" case needs EVERY call — including the
// repeated poll-loop re-checks inside waitForVerifyCompletion — to keep
// returning verify_done, not fall through to a "task not found" null once the
// array is exhausted.
let resolveWorkflowStateSequence: (TaskWorkflowState | null)[] = [];
let resolveWorkflowStateCallIndex = 0;
const resolveTaskWorkflowStateMock = mock((): Promise<TaskWorkflowState | null> => {
  const idx = Math.min(resolveWorkflowStateCallIndex, resolveWorkflowStateSequence.length - 1);
  resolveWorkflowStateCallIndex++;
  return Promise.resolve(idx >= 0 ? resolveWorkflowStateSequence[idx] : null);
});

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
  taskRowConfirmedAbsent: mock(() => Promise.resolve(false)),
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
      currentPhase: extra?.currentPhase ?? 'verify_done',
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

const queueMock = {
  getMaxConcurrency: () => 2,
  dequeue: dequeueMock,
  updateStatus: updateStatusMock,
  retryIfPossible: mock(() => Promise.resolve(false)),
  findByTaskId: mock(() => Promise.resolve(null)),
  notifyItemUpdate: () => {},
};

mock.module('./workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => queueMock },
}));

const advanceWorkflowMock = mock(
  (): Promise<WorkflowAdvanceResult> =>
    Promise.resolve({ success: true, role: 'verifier', status: 'verify_done', skipped: false }),
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

const broadcastItemUpdateCalls: { event: string; phase: string }[] = [];
const broadcastItemUpdateMock = mock(
  (_itemId: number, _taskId: number, event: string, phase: string) => {
    broadcastItemUpdateCalls.push({ event, phase });
  },
);

mock.module('./workflow-runner-events', () => ({
  logPhaseTransition: mock(() => Promise.resolve()),
  broadcastRunnerStatus: mock(() => {}),
  broadcastItemUpdate: broadcastItemUpdateMock,
}));

mock.module('../agents/stop-task-agents', () => ({
  stopTaskAgents: mock(() => Promise.resolve({ stoppedCount: 0, executionIds: [] })),
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
  updateStatusMock.mockClear();
  taskUpdateMock.mockClear();
  advanceWorkflowMock.mockClear();
  onSubtaskCompletedMock.mockClear();
  resolveTaskWorkflowStateMock.mockClear();
  broadcastItemUpdateCalls.length = 0;
  dequeueSequence = [];
  resolveWorkflowStateSequence = [];
  resolveWorkflowStateCallIndex = 0;
}

const QUEUE_ITEM: QueueItem = {
  id: 40,
  taskId: 8,
  orchestraSessionId: null,
  priority: 0,
  status: 'running',
  currentPhase: 'verify_done',
  dependencies: [],
  retryCount: 0,
  maxRetries: 3,
  errorMessage: null,
  queuedAt: new Date(),
  startedAt: new Date(),
  completedAt: null,
};

function state(overrides: Partial<TaskWorkflowState>): TaskWorkflowState {
  return {
    id: QUEUE_ITEM.taskId,
    status: 'in-progress',
    workflowStatus: 'verify_done',
    workflowMode: null,
    parentId: null,
    ...overrides,
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

async function runAndSettle(
  runner: InstanceType<typeof WorkflowRunner>,
  timeoutMs = 5000,
): Promise<void> {
  dequeueSequence = [QUEUE_ITEM, null];
  runner.startProcessing(60_000);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await waitUntil(() => runner.getStatus().activeItems === 0, timeoutMs);
  await runner.stopProcessing();
}

describe('WorkflowRunner — verify_done settle', () => {
  beforeEach(() => {
    resetMocks();
    resetRunner();
  });

  test('settles as completed and finalizes the queue item', async () => {
    resolveWorkflowStateSequence = [
      state({ workflowStatus: 'verify_done' }),
      state({ workflowStatus: 'completed', status: 'done' }),
    ];
    const runner = WorkflowRunner.getInstance();
    await runAndSettle(runner);

    expect(updateStatusMock).toHaveBeenCalledWith(
      QUEUE_ITEM.id,
      'completed',
      expect.objectContaining({ currentPhase: 'completed' }),
    );
    expect(broadcastItemUpdateCalls).toContainEqual({
      event: 'workflow_completed',
      phase: 'completed',
    });
  });

  test('completed subtask propagates to the parent', async () => {
    resolveWorkflowStateSequence = [
      state({ workflowStatus: 'verify_done', parentId: 55 }),
      state({ workflowStatus: 'completed', status: 'done', parentId: 55 }),
    ];
    const runner = WorkflowRunner.getInstance();
    await runAndSettle(runner);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSubtaskCompletedMock).toHaveBeenCalledWith(QUEUE_ITEM.taskId);
  });

  test('moved to another phase re-loops instead of failing', async () => {
    resolveWorkflowStateSequence = [
      state({ workflowStatus: 'verify_done' }),
      // waitForVerifyCompletion's own re-check sees the bounce (e.g. self-repair).
      state({ workflowStatus: 'in_progress' }),
      state({ workflowStatus: 'completed', status: 'done' }),
    ];
    const runner = WorkflowRunner.getInstance();
    await runAndSettle(runner);

    expect(updateStatusMock.mock.calls.some((c) => c[1] === 'failed')).toBe(false);
    expect(updateStatusMock).toHaveBeenCalledWith(
      QUEUE_ITEM.id,
      'completed',
      expect.objectContaining({ currentPhase: 'completed' }),
    );
  });

  test('a stop landing during the grace window ends the loop without marking it failed', async () => {
    resolveWorkflowStateSequence = [state({ workflowStatus: 'verify_done' })];
    let runnerRef: InstanceType<typeof WorkflowRunner> | undefined;
    const runner = WorkflowRunner.getInstance();
    runnerRef = runner;
    dequeueSequence = [QUEUE_ITEM, null];
    runner.startProcessing(60_000);

    // Abort shortly after start, landing inside the 2s poll wait inside
    // waitForVerifyCompletion (well before the 1000ms grace deadline or the 2s poll elapse).
    await new Promise((resolve) => setTimeout(resolve, 30));
    runnerRef.abortTask(QUEUE_ITEM.taskId);

    await waitUntil(() => runner.getStatus().activeItems === 0, 5000);
    await runner.stopProcessing();

    expect(updateStatusMock.mock.calls.some((c) => c[1] === 'failed')).toBe(false);
  });

  // NOTE: the poll interval inside waitForVerifyCompletion is a hardcoded 2s
  // (VERIFY_SETTLE_POLL_MS, not env-overridable) — this test genuinely waits out
  // one real poll tick before the 1000ms grace deadline is judged exceeded.
  test('still verify_done past the grace window is a real failure', async () => {
    resolveWorkflowStateSequence = [state({ workflowStatus: 'verify_done' })];
    const runner = WorkflowRunner.getInstance();
    await runAndSettle(runner, 6000);

    expect(updateStatusMock).toHaveBeenCalledWith(
      QUEUE_ITEM.id,
      'failed',
      expect.objectContaining({
        errorMessage: expect.stringContaining('did not pass the completion gate'),
      }),
    );
    expect(broadcastItemUpdateCalls).toContainEqual({
      event: 'execution_failed',
      phase: 'verify_done',
    });
  }, 8000);
});
