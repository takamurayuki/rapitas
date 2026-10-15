/**
 * workflow-runner.phases.test
 *
 * Covers the 'completed' and 'plan_created' decision branches inside
 * WorkflowRunner.executeWorkflowItem: completion + subtask propagation, and the
 * auto-approve precedence (task-level > user-level > per-subtask) vs. the
 * wait-for-approval path.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { QueueItem } from './workflow-queue';
import type { WorkflowAdvanceResult } from './workflow-types';
import type { TaskWorkflowState, TaskForPlanApproval } from '../task/task-resolver';

const warnMock = mock((..._a: unknown[]) => {});
const loggerMock = { info: () => {}, warn: warnMock, error: () => {}, debug: () => {} };

mock.module('../../config/logger', () => ({
  createLogger: () => loggerMock,
  logger: loggerMock,
  getBackendLogFilePath: () => '/tmp/fake-backend.log',
}));

let userSettingsRow: Record<string, unknown> | null = null;
const taskUpdateMock = mock((_args: { where: { id: number }; data: Record<string, unknown> }) =>
  Promise.resolve({}),
);
const prismaMock = {
  task: { findUnique: mock(() => Promise.resolve(null)), update: taskUpdateMock },
  userSettings: { findFirst: mock(() => Promise.resolve(userSettingsRow)) },
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

let resolveWorkflowStateSequence: (TaskWorkflowState | null)[] = [];
const resolveTaskWorkflowStateMock = mock(
  (): Promise<TaskWorkflowState | null> =>
    Promise.resolve(resolveWorkflowStateSequence.shift() ?? null),
);
let planApprovalRow: TaskForPlanApproval | null = null;
const resolveTaskForPlanApprovalMock = mock(() => Promise.resolve(planApprovalRow));

mock.module('../task/task-resolver', () => ({
  resolveTaskWorkflowState: resolveTaskWorkflowStateMock,
  resolveTaskForPlanApproval: resolveTaskForPlanApprovalMock,
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
    Promise.resolve({ success: true, role: 'researcher', status: 'in_progress', skipped: false }),
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
  planApprovalRow = null;
  userSettingsRow = null;
}

const QUEUE_ITEM: QueueItem = {
  id: 20,
  taskId: 5,
  orchestraSessionId: null,
  priority: 0,
  status: 'running',
  currentPhase: 'plan_created',
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
    workflowStatus: 'in_progress',
    workflowMode: null,
    parentId: null,
    ...overrides,
  };
}

/**
 * Runs one execution pass to completion. All dependencies resolve instantly, so
 * a pass can finish inside a single microtask burst — faster than a 10ms poll
 * tick can observe "started". Give it a short head start before polling for
 * settle, so stopProcessing() never races the item's own registration (which
 * would otherwise force a "Runner shutdown" abort instead of natural completion).
 */
async function runAndSettle(runner: InstanceType<typeof WorkflowRunner>): Promise<void> {
  dequeueSequence = [QUEUE_ITEM, null];
  runner.startProcessing(60_000);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const deadline = Date.now() + 3000;
  while (runner.getStatus().activeItems > 0) {
    if (Date.now() > deadline) throw new Error('execution did not settle in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await runner.stopProcessing();
}

describe('WorkflowRunner — completion', () => {
  beforeEach(() => {
    resetMocks();
    resetRunner();
  });

  test('completed status finalizes the queue item as completed', async () => {
    resolveWorkflowStateSequence = [state({ workflowStatus: 'completed', status: 'done' })];
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
    expect(onSubtaskCompletedMock).not.toHaveBeenCalled();
  });

  test('completed subtask propagates completion to its parent', async () => {
    resolveWorkflowStateSequence = [
      state({ workflowStatus: 'completed', status: 'done', parentId: 99 }),
    ];
    const runner = WorkflowRunner.getInstance();
    await runAndSettle(runner);

    // onSubtaskCompleted is fired via a fire-and-forget dynamic import — flush microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSubtaskCompletedMock).toHaveBeenCalledWith(QUEUE_ITEM.taskId);
  });
});

describe('WorkflowRunner — plan_created auto-approve', () => {
  beforeEach(() => {
    resetMocks();
    resetRunner();
  });

  test('task-level autoApprovePlan advances without waiting', async () => {
    planApprovalRow = { id: QUEUE_ITEM.taskId, autoApprovePlan: true, parentId: null };
    resolveWorkflowStateSequence = [
      state({ workflowStatus: 'plan_created' }),
      state({ workflowStatus: 'completed', status: 'done' }),
    ];
    const runner = WorkflowRunner.getInstance();
    await runAndSettle(runner);

    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: QUEUE_ITEM.taskId },
      data: { workflowStatus: 'plan_approved', status: 'in-progress' },
    });
    expect(broadcastItemUpdateCalls).toContainEqual({
      event: 'phase_completed',
      phase: 'plan_created',
    });
  });

  test('user-level autoApprovePlan advances when the task flag is unset', async () => {
    planApprovalRow = { id: QUEUE_ITEM.taskId, autoApprovePlan: false, parentId: null };
    userSettingsRow = { autoApprovePlan: true };
    resolveWorkflowStateSequence = [
      state({ workflowStatus: 'plan_created' }),
      state({ workflowStatus: 'completed', status: 'done' }),
    ];
    const runner = WorkflowRunner.getInstance();
    await runAndSettle(runner);

    expect(taskUpdateMock).toHaveBeenCalledTimes(1);
  });

  test('per-subtask autoApproveSubtaskPlan advances a subtask when other flags are off', async () => {
    planApprovalRow = { id: QUEUE_ITEM.taskId, autoApprovePlan: false, parentId: 99 };
    userSettingsRow = { autoApprovePlan: false, autoApproveSubtaskPlan: true };
    resolveWorkflowStateSequence = [
      state({ workflowStatus: 'plan_created', parentId: 99 }),
      state({ workflowStatus: 'completed', status: 'done', parentId: 99 }),
    ];
    const runner = WorkflowRunner.getInstance();
    await runAndSettle(runner);

    expect(taskUpdateMock).toHaveBeenCalledTimes(1);
  });

  test('no auto-approve flag set waits for manual approval', async () => {
    planApprovalRow = { id: QUEUE_ITEM.taskId, autoApprovePlan: false, parentId: null };
    userSettingsRow = { autoApprovePlan: false };
    resolveWorkflowStateSequence = [state({ workflowStatus: 'plan_created' })];
    const runner = WorkflowRunner.getInstance();
    await runAndSettle(runner);

    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(updateStatusMock).toHaveBeenCalledWith(QUEUE_ITEM.id, 'waiting_approval', {
      currentPhase: 'plan_created',
    });
    expect(broadcastItemUpdateCalls).toContainEqual({
      event: 'waiting_approval',
      phase: 'plan_created',
    });
    // Only one resolveTaskWorkflowState read should occur — the loop must stop, not spin.
    expect(resolveTaskWorkflowStateMock).toHaveBeenCalledTimes(1);
  });
});
