/**
 * workflow-runner.phases.test-support
 *
 * The mocked collaborators shared by the WorkflowRunner phase tests. Import it
 * before anything that loads the runner. Contains no tests.
 */
import { mock } from 'bun:test';
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

/** Row values each test arranges before running the runner. */
export const fixtures = {
  states: [] as (TaskWorkflowState | null)[],
  planApproval: null as TaskForPlanApproval | null,
  userSettings: null as Record<string, unknown> | null,
};

export const taskUpdateManyMock = mock(
  (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
    Promise.resolve({ count: 1 }),
);
const prismaMock = {
  task: { findUnique: mock(() => Promise.resolve(null)), updateMany: taskUpdateManyMock },
  userSettings: { findFirst: mock(() => Promise.resolve(fixtures.userSettings)) },
};

// The execution lock imports config/database directly; keep it off a real database.
mock.module('../../config/database', () => ({
  prisma: prismaMock,
  ensureDatabaseConnection: () => Promise.resolve(),
}));

mock.module('../../config', () => ({
  prisma: prismaMock,
  ensureDatabaseConnection: () => Promise.resolve(),
  logger: loggerMock,
  createLogger: () => loggerMock,
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => 'default',
  getProjectRoot: () => '/tmp/rapitas-test',
}));

export const resolveTaskWorkflowStateMock = mock(
  (): Promise<TaskWorkflowState | null> => Promise.resolve(fixtures.states.shift() ?? null),
);
const resolveTaskForPlanApprovalMock = mock(() => Promise.resolve(fixtures.planApproval));

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

let dequeueSequence: (QueueItem | null)[] = [];
const dequeueMock = mock(async (): Promise<QueueItem | null> => dequeueSequence.shift() ?? null);
export const updateStatusMock = mock(
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

export const queueMock = {
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

export const broadcastItemUpdateCalls: { event: string; phase: string }[] = [];
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

export const onSubtaskCompletedMock = mock(() => Promise.resolve());

mock.module('./subtask-completion-handler', () => ({
  onSubtaskCompleted: onSubtaskCompletedMock,
  isSubtaskFinished: () => true,
  isSubtaskFailed: () => false,
  isSubtaskPassed: () => true,
  isParentFinalizable: () => true,
}));

// NOTE: shouldAutoApprovePlan consults this module, which imports prisma from
// config/database directly — NOT the '../../config' mocked above. Unmocked, every
// auto-approve test opened a real PostgreSQL connection and waited for it to
// fail: instant in CI, ~5s on a dev machine, past runAndSettle's 3s deadline
// (#1208). The hold itself is covered by plan-auto-approve.plan-hold-notify.
mock.module('./forbidden-change-plan-hold', () => ({
  PLAN_FORBIDDEN_CHANGE_HOLD_CAUSE: 'plan_forbidden_change_hold',
  buildOverrideInstruction: () => '',
  resolveForbiddenChangePlanHold: () => Promise.resolve(null),
}));

const { WorkflowRunner } = await import('./workflow-runner');
export { WorkflowRunner };

/** Drop the singleton so each test gets a fresh runner. */
export function resetRunner(): void {
  (WorkflowRunner as unknown as { instance: unknown }).instance = undefined;
}

/** Clear every call record and arranged row. */
export function resetMocks(): void {
  updateStatusMock.mockClear();
  taskUpdateManyMock.mockClear();
  advanceWorkflowMock.mockClear();
  onSubtaskCompletedMock.mockClear();
  resolveTaskWorkflowStateMock.mockClear();
  queueMock.retryIfPossible.mockClear();
  broadcastItemUpdateCalls.length = 0;
  dequeueSequence = [];
  fixtures.states = [];
  fixtures.planApproval = null;
  fixtures.userSettings = null;
}

export const QUEUE_ITEM: QueueItem = {
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

/** A workflow state row for the queued task. */
export function state(overrides: Partial<TaskWorkflowState>): TaskWorkflowState {
  return {
    id: QUEUE_ITEM.taskId,
    status: 'in-progress',
    workflowStatus: 'in_progress',
    workflowMode: null,
    parentId: null,
    ...overrides,
  };
}

/** Dequeue the item once and let the runner start on it. */
export function startItem(runner: ReturnType<typeof WorkflowRunner.getInstance>): void {
  dequeueSequence = [QUEUE_ITEM, null];
  runner.startProcessing(60_000);
}

/**
 * Waits for the started item to settle, then stops the runner. All dependencies
 * resolve instantly, so a pass can finish inside a single microtask burst —
 * faster than a 10ms poll tick can observe "started". Give it a short head start
 * before polling, so stopProcessing() never races the item's own registration
 * (which would otherwise force a "Runner shutdown" abort).
 */
export async function settleItem(
  runner: ReturnType<typeof WorkflowRunner.getInstance>,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
  const deadline = Date.now() + 3000;
  while (runner.getStatus().activeItems > 0) {
    if (Date.now() > deadline) throw new Error('execution did not settle in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await runner.stopProcessing();
}

/** Runs one execution pass to completion. */
export async function runAndSettle(
  runner: ReturnType<typeof WorkflowRunner.getInstance>,
): Promise<void> {
  startItem(runner);
  await settleItem(runner);
}
