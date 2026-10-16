/**
 * workflow-runner.halt-inflight.test
 *
 * iteration budget の halt は「選定」だけを止めており、すでに dequeue 済みの
 * queue item は次フェーズを発行し続けていた (task 1107: 05:42 halt → 05:50
 * implementer → 05:55 に 35 ファイルの auto-commit)。halt 中のタスクは次の
 * エージェントフェーズを発行せず item を parked にすること、および
 * verify_done(既払いの成果物の公開)は halt で止めないことを固定する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { QueueItem } from './workflow-queue';
import type { WorkflowAdvanceResult } from './workflow-types';
import type { TaskWorkflowState } from '../task/task-resolver';

const loggerMock = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

mock.module('../../config/logger', () => ({
  createLogger: () => loggerMock,
  logger: loggerMock,
  getBackendLogFilePath: () => '/tmp/fake-backend.log',
}));

/** Halt state the guard's own prisma lookup resolves to. */
let haltRow: { haltReason: string | null } | null = null;
let haltLookupThrows = false;
const haltFindUniqueMock = mock(() => {
  if (haltLookupThrows) return Promise.reject(new Error('db down'));
  return Promise.resolve(haltRow);
});

// Guard and runner both read prisma from the '../../config' barrel, so one mock
// serves both (and adds no second process-global module mock to leak elsewhere).
mock.module('../../config', () => ({
  prisma: {
    task: {
      findUnique: haltFindUniqueMock,
      update: mock(() => Promise.resolve({})),
    },
    userSettings: { findFirst: mock(() => Promise.resolve(null)) },
  },
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
      taskId: 7,
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

const queueMock = {
  getMaxConcurrency: () => 2,
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
  Promise.resolve({ success: true, role: 'researcher', status: 'plan_created', skipped: false });
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

const { resolveInflightHaltReason, haltParkMessage } = await import('./workflow-runner-halt-guard');
const { WorkflowRunner } = await import('./workflow-runner');

function resetRunner(): void {
  (WorkflowRunner as unknown as { instance: unknown }).instance = undefined;
}

function resetMocks(): void {
  updateStatusMock.mockClear();
  retryIfPossibleMock.mockClear();
  advanceWorkflowMock.mockClear();
  resolveTaskWorkflowStateMock.mockClear();
  haltFindUniqueMock.mockClear();
  broadcastItemUpdateCalls.length = 0;
  dequeueSequence = [];
  resolveWorkflowStateSequence = [];
  haltRow = null;
  haltLookupThrows = false;
  advanceWorkflowImpl = () =>
    Promise.resolve({ success: true, role: 'researcher', status: 'plan_created', skipped: false });
}

const QUEUE_ITEM: QueueItem = {
  id: 4097,
  taskId: 1107,
  orchestraSessionId: null,
  priority: 0,
  status: 'running',
  currentPhase: 'plan_approved',
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
    workflowStatus: 'plan_approved',
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
  timeoutMs = 3000,
): Promise<void> {
  dequeueSequence = [QUEUE_ITEM, null];
  runner.startProcessing(60_000);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await waitUntil(() => runner.getStatus().activeItems === 0, timeoutMs);
  await runner.stopProcessing();
}

describe('resolveInflightHaltReason', () => {
  beforeEach(resetMocks);

  test('returns the halt reason for a dispatchable phase', async () => {
    haltRow = { haltReason: 'budget_cost_exceeded' };
    expect(await resolveInflightHaltReason(1107, 'plan_approved')).toBe('budget_cost_exceeded');
  });

  test('returns null when the task is not halted', async () => {
    haltRow = { haltReason: null };
    expect(await resolveInflightHaltReason(1107, 'plan_approved')).toBeNull();
  });

  test('does not block verify_done — publishing already-paid-for work is not new spend', async () => {
    haltRow = { haltReason: 'budget_cost_exceeded' };
    expect(await resolveInflightHaltReason(1107, 'verify_done')).toBeNull();
    expect(haltFindUniqueMock).not.toHaveBeenCalled();
  });

  test('fails open when the halt lookup throws', async () => {
    haltLookupThrows = true;
    expect(await resolveInflightHaltReason(1107, 'plan_approved')).toBeNull();
  });

  test('haltParkMessage names the task, phase and reason', () => {
    const msg = haltParkMessage(1107, 'plan_approved', 'budget_cost_exceeded');
    expect(msg).toContain('1107');
    expect(msg).toContain('plan_approved');
    expect(msg).toContain('budget_cost_exceeded');
  });
});

describe('WorkflowRunner — halted task already in flight', () => {
  beforeEach(() => {
    resetMocks();
    resetRunner();
  });

  test('parks the queue item instead of dispatching the next phase', async () => {
    haltRow = { haltReason: 'budget_cost_exceeded' };
    resolveWorkflowStateSequence = [state({ workflowStatus: 'plan_approved' })];

    const runner = WorkflowRunner.getInstance();
    await runAndSettle(runner);

    expect(advanceWorkflowMock).not.toHaveBeenCalled();
    const cancelled = updateStatusMock.mock.calls.find(
      (c) => c[0] === QUEUE_ITEM.id && c[1] === 'cancelled',
    );
    expect(cancelled).toBeDefined();
    expect(String((cancelled?.[2] as { errorMessage?: string })?.errorMessage)).toContain(
      'budget_cost_exceeded',
    );
    expect(broadcastItemUpdateCalls).not.toContainEqual({
      event: 'phase_started',
      phase: 'plan_approved',
    });
  }, 7000);

  test('an unhalted task still dispatches its phase', async () => {
    haltRow = { haltReason: null };
    resolveWorkflowStateSequence = [
      state({ workflowStatus: 'plan_approved' }),
      state({ workflowStatus: 'completed', status: 'done' }),
    ];
    advanceWorkflowImpl = () =>
      Promise.resolve({
        success: true,
        role: 'implementer',
        status: 'in_progress',
        skipped: false,
      });

    const runner = WorkflowRunner.getInstance();
    await runAndSettle(runner, 5000);

    expect(advanceWorkflowMock).toHaveBeenCalledWith(QUEUE_ITEM.taskId);
  }, 7000);
});
