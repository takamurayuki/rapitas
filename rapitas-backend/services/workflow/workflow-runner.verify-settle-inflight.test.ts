/**
 * workflow-runner.verify-settle-inflight.test
 *
 * Runner-level regression for task 657: registers a task as in-flight via the
 * REAL verify-completion-inflight registry (mirroring what
 * verify-commit-pr.ts now does for the whole commit/PR/recovery/retry
 * pipeline, not just the initial attempt) and exercises
 * WorkflowRunner.waitForVerifyCompletion directly against it.
 *
 * - While in-flight is true, the settle grace window (VERIFY_SETTLE_MS) alone
 *   must NOT cause a stuck/failed verdict — mirrors task 653, where the
 *   recovery+retry pipeline was still running well past the naive window.
 * - Once wall-clock exceeds the hard cap (VERIFY_SETTLE_CAP_MS), a still
 *   in-flight task is judged stuck anyway — the cap is unchanged by this fix
 *   and must keep failing a genuinely wedged pipeline.
 *
 * Both settle/cap windows are set far below their defaults so the tests run
 * in real seconds; the 2s poll interval inside waitForVerifyCompletion is
 * hardcoded and not overridable, so each case costs one or two real polls.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { QueueItem } from './workflow-queue';
import type { WorkflowAdvanceResult } from './workflow-types';
import type { TaskWorkflowState } from '../task/task-resolver';

process.env.RAPITAS_VERIFY_SETTLE_MS = '100';
process.env.RAPITAS_VERIFY_SETTLE_CAP_MS = '100';

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

// Sticky-last (not shift): repeated poll-loop re-checks inside
// waitForVerifyCompletion must keep returning the last queued state instead
// of falling through to a "task not found" null once the array is exhausted.
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

mock.module('./subtask-completion-handler', () => ({
  onSubtaskCompleted: mock(() => Promise.resolve()),
  isSubtaskFinished: () => true,
  isSubtaskFailed: () => false,
  isSubtaskPassed: () => true,
  isParentFinalizable: () => true,
}));

// NOTE: verify-completion-inflight is intentionally NOT mocked — these tests
// drive the REAL registry, exactly like verify-commit-pr.ts does in production.
const { WorkflowRunner } = await import('./workflow-runner');
const { registerVerifyCompletion, resetVerifyCompletionRegistry } =
  await import('./verify-completion-inflight');

function resetRunner(): void {
  (WorkflowRunner as unknown as { instance: unknown }).instance = undefined;
}

function resetMocks(): void {
  updateStatusMock.mockClear();
  taskUpdateMock.mockClear();
  advanceWorkflowMock.mockClear();
  resolveTaskWorkflowStateMock.mockClear();
  broadcastItemUpdateCalls.length = 0;
  dequeueSequence = [];
  resolveWorkflowStateSequence = [];
  resolveWorkflowStateCallIndex = 0;
  resetVerifyCompletionRegistry();
}

const QUEUE_ITEM: QueueItem = {
  id: 653,
  taskId: 653,
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
  timeoutMs = 6000,
): Promise<void> {
  dequeueSequence = [QUEUE_ITEM, null];
  runner.startProcessing(60_000);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await waitUntil(() => runner.getStatus().activeItems === 0, timeoutMs);
  await runner.stopProcessing();
}

describe('WorkflowRunner — verify_done settle × in-flight registry (task 657)', () => {
  beforeEach(() => {
    resetMocks();
    resetRunner();
  });

  test('in-flight の間は settle 猶予(100ms)を超えても stuck 判定されず、in-flight 解除後に completed へ遷移する', async () => {
    // Registered with a never-resolving Promise for the duration of this
    // test — same shape as runVerifyCommitPrPipeline's returned Promise
    // while recovery+retry are still running.
    registerVerifyCompletion(QUEUE_ITEM.taskId, new Promise(() => {}));

    resolveWorkflowStateSequence = [
      state({ workflowStatus: 'verify_done' }), // immediate check — settle window (100ms) not yet elapsed
      state({ workflowStatus: 'verify_done' }), // 1st poll (~2s) — still in-flight, past settle window but not stuck
      state({ workflowStatus: 'completed', status: 'done' }), // 2nd poll — pipeline result observed
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

  test('ハードキャップ(100ms)を超えると in-flight のままでも stuck 判定される(従来どおり)', async () => {
    registerVerifyCompletion(QUEUE_ITEM.taskId, new Promise(() => {}));
    resolveWorkflowStateSequence = [state({ workflowStatus: 'verify_done' })];
    const runner = WorkflowRunner.getInstance();
    await runAndSettle(runner);

    expect(updateStatusMock).toHaveBeenCalledWith(
      QUEUE_ITEM.id,
      'failed',
      expect.objectContaining({
        errorMessage: expect.stringContaining('did not pass the completion gate'),
      }),
    );
  });
});
