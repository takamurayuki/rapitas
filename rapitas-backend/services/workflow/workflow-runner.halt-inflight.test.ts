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
let haltRow: { haltReason: string | null; themeId?: number | null } | null = null;
/** ThemeAutoRun row the theme-pause guard resolves to (task 1535). */
let themeRunRow: { status: string } | null = null;
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
    themeAutoRun: { findFirst: mock(() => Promise.resolve(themeRunRow)) },
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
  resolvePreferredBaseBranch: mock(() => Promise.resolve('develop')),
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

// 共通入口の実装は保持し、結合ケースだけでrunnerへ接続する。
const { WorkflowOrchestrator: ActualOrchestrator } = await import('./workflow-orchestrator');

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
  themeRunRow = null;
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
  test('実runnerから実orchestrator入口へ進み、台帳を解除する', async () => {
    resetMocks();
    resetRunner();
    const actual = ActualOrchestrator.getInstance();
    const internal = actual as unknown as {
      advanceAdmitted: (id: number) => Promise<WorkflowAdvanceResult>;
    };
    const original = internal.advanceAdmitted;
    const { getLedgerTaskIds } =
      await import('../scheduling/auto-restart-merged-code/execution-ledger');
    let phases = 0;
    internal.advanceAdmitted = async () => {
      expect(getLedgerTaskIds()).toContain(QUEUE_ITEM.taskId);
      phases++;
      return { success: true, role: 'implementer', status: 'plan_approved', skipped: true };
    };
    const runner = WorkflowRunner.getInstance();
    (runner as unknown as { orchestrator: typeof actual }).orchestrator = actual;
    resolveWorkflowStateSequence = [state({})];
    try {
      await runAndSettle(runner);
      expect(phases).toBe(1);
      expect(getLedgerTaskIds()).toEqual([]);
      expect(retryIfPossibleMock).not.toHaveBeenCalled();
    } finally {
      internal.advanceAdmitted = original;
      await runner.stopProcessing();
    }
  });
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

  test('paused theme: requeues the item and does not dispatch the next phase (task 1535)', async () => {
    haltRow = { haltReason: null, themeId: 35 };
    themeRunRow = { status: 'paused_user' };
    resolveWorkflowStateSequence = [state({ workflowStatus: 'plan_approved' })];

    const runner = WorkflowRunner.getInstance();
    await runAndSettle(runner);

    expect(advanceWorkflowMock).not.toHaveBeenCalled();
    expect(
      updateStatusMock.mock.calls.find((c) => c[0] === QUEUE_ITEM.id && c[1] === 'queued'),
    ).toBeDefined();
    expect(broadcastItemUpdateCalls).toContainEqual({
      event: 'execution_requeued',
      phase: 'plan_approved',
    });
  }, 7000);

  test('running theme still dispatches its next phase', async () => {
    haltRow = { haltReason: null, themeId: 35 };
    themeRunRow = { status: 'running' };
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

  // Task 1562: while merged code waits to activate, the finished phase ends and the next one
  // is held as `queued` — even for a theme that is still running.
  /** Runs `run` with a scratch data dir and the helpers that start/stop a restart wait. */
  async function withRestartWait(run: (begin: () => void) => Promise<void>): Promise<void> {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const previous = process.env.RAPITAS_DATA_DIR;
    const dir = mkdtempSync(join(tmpdir(), 'halt-inflight-wait-'));
    process.env.RAPITAS_DATA_DIR = dir;
    const wait = await import('../scheduling/auto-restart-merged-code/restart-wait');
    const store = await import('../scheduling/auto-restart-merged-code/restart-wait-store');
    try {
      wait.resetRestartWaitCache();
      await run(() => {
        store.writeRestartWaitState({ waitStartedAt: Date.now(), phase: 'waiting' });
        wait.resetRestartWaitCache();
      });
    } finally {
      wait.resetRestartWaitCache();
      if (previous === undefined) delete process.env.RAPITAS_DATA_DIR;
      else process.env.RAPITAS_DATA_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('restart wait that begins after the item started: the next phase is requeued, not dispatched', async () => {
    await withRestartWait(async (begin) => {
      haltRow = { haltReason: null, themeId: 35 };
      themeRunRow = { status: 'running' };
      // The wait begins while the runner reads the task, i.e. AFTER the item was dequeued.
      resolveTaskWorkflowStateMock.mockImplementationOnce(() => {
        begin();
        return Promise.resolve(state({ workflowStatus: 'plan_approved' }));
      });

      await runAndSettle(WorkflowRunner.getInstance());

      expect(advanceWorkflowMock).not.toHaveBeenCalled();
      expect(
        updateStatusMock.mock.calls.find((c) => c[0] === QUEUE_ITEM.id && c[1] === 'queued'),
      ).toBeDefined();
      expect(broadcastItemUpdateCalls).toContainEqual({
        event: 'execution_requeued',
        phase: 'plan_approved',
      });
    });
  }, 7000);

  test('a wait that begins while the theme state is being read still holds the phase back', async () => {
    await withRestartWait(async (begin) => {
      const { parkItemIfHalted } = await import('./workflow-runner-halt-guard');
      // Reading themeId happens inside the theme lookup, after the halt check passed.
      haltRow = {
        haltReason: null,
        get themeId() {
          begin();
          return 35;
        },
      };
      themeRunRow = { status: 'running' };
      const events: string[] = [];
      const parked = await parkItemIfHalted(
        queueMock,
        { id: QUEUE_ITEM.id, taskId: QUEUE_ITEM.taskId },
        'plan_approved',
        (event) => events.push(event),
      );
      expect(parked).toBe(true);
      expect(events).toEqual(['execution_requeued']);
    });
  });

  test('restart wait does not hold back verify_done (publishing paid-for work)', async () => {
    await withRestartWait(async (begin) => {
      begin();
      const { parkItemIfHalted } = await import('./workflow-runner-halt-guard');
      const parked = await parkItemIfHalted(
        queueMock,
        { id: QUEUE_ITEM.id, taskId: QUEUE_ITEM.taskId },
        'verify_done',
        () => {},
      );
      expect(parked).toBe(false);
    });
  });

  test('次フェーズの確認から登録まで待機開始を直列化し、実行完了はロック外で待つ', async () => {
    await withRestartWait(async () => {
      const { tickRestartWait } =
        await import('../scheduling/auto-restart-merged-code/restart-wait');
      let entered!: () => void;
      let releaseCheck!: () => void;
      let finish!: (value: WorkflowAdvanceResult) => void;
      const checking = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const checkHeld = new Promise<void>((resolve) => {
        releaseCheck = resolve;
      });
      const completion = new Promise<WorkflowAdvanceResult>((resolve) => {
        finish = resolve;
      });
      const order: string[] = [];
      haltFindUniqueMock.mockImplementationOnce(async () => {
        entered();
        await checkHeld;
        return { haltReason: null };
      });
      resolveWorkflowStateSequence = [state({ workflowStatus: 'plan_approved' })];
      advanceWorkflowImpl = () => {
        order.push('登録');
        return completion;
      };
      const runner = WorkflowRunner.getInstance();
      const execution = (
        runner as unknown as {
          executeWorkflowItem(item: QueueItem): Promise<void>;
        }
      ).executeWorkflowItem(QUEUE_ITEM);
      await checking;
      const waiting = tickRestartWait({
        aheadCount: 1,
        changedPaths: ['prisma/schema/a.prisma'],
        lastRestartAt: 0,
        evaluate: async () => false,
        listRunningThemeIds: async () => {
          order.push('待機');
          return [35];
        },
      });
      releaseCheck();
      try {
        await waiting;
        expect(order).toEqual(['登録', '待機']);
        expect(runner.getStatus().activeItems).toBe(1);
      } finally {
        finish({ success: true, role: 'implementer', status: 'plan_approved', skipped: true });
        await execution;
      }
    });
  });

  test('同じ項目: paused で queued に戻り、テーマ再開後に再 dequeue されると次フェーズを dispatch する', async () => {
    haltRow = { haltReason: null, themeId: 35 };
    themeRunRow = { status: 'paused_user' };
    resolveWorkflowStateSequence = [state({ workflowStatus: 'plan_approved' })];

    const runner = WorkflowRunner.getInstance();
    await runAndSettle(runner);
    expect(advanceWorkflowMock).not.toHaveBeenCalled();
    expect(
      updateStatusMock.mock.calls.find((c) => c[0] === QUEUE_ITEM.id && c[1] === 'queued'),
    ).toBeDefined();

    // テーマ再開: dequeue ガードが同じ queued 項目を running に戻して渡す
    themeRunRow = { status: 'running' };
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
    resetRunner();
    await runAndSettle(WorkflowRunner.getInstance(), 5000);

    expect(advanceWorkflowMock).toHaveBeenCalledWith(QUEUE_ITEM.taskId);
  }, 12000);
});
