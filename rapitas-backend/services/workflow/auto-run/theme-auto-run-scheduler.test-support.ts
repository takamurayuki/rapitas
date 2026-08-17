/**
 * theme-auto-run-scheduler.test-support
 *
 * Shared bun:test mock scaffolding for theme-auto-run-scheduler.test.ts and its
 * sibling split files. Centralised here so every mock.module() call (and its
 * "mirror ALL real exports" obligation) is defined exactly once instead of
 * duplicated per file. bunfig.toml sets `isolate = true`, so each *.test.ts file
 * gets its own module registry — safe for every file importing this module to
 * independently re-run this setup without leaking into unrelated suites (e.g.
 * auto-run-selection.test.ts, theme-auto-run-service.test.ts).
 *
 * Every dependency of theme-auto-run-scheduler.ts is replaced with a
 * controllable mock so the scheduler's OWN branching logic (not the already
 * independently-tested selection/service helpers) is what gets exercised.
 */
import { mock } from 'bun:test';
import type { ThemeAutoRunState } from './theme-auto-run-service';

// ---------------------------------------------------------------------------
// Silent logger (mirrors the shape used elsewhere: info/warn/error/debug)
// ---------------------------------------------------------------------------
const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// ---------------------------------------------------------------------------
// prisma (config) mocks
// ---------------------------------------------------------------------------
export const mockTaskCount = mock(() => Promise.resolve(0));
export const mockTaskFindMany = mock(() => Promise.resolve([] as Array<{ id: number }>));
export const mockTaskUpdate = mock(() => Promise.resolve({}));
export const mockTaskFindUnique = mock(() =>
  Promise.resolve(null as { workflowStatus: string } | null),
);
export const mockThemeAutoRunUpdateMany = mock(() => Promise.resolve({ count: 0 }));
export const mockThemeAutoRunCount = mock(() => Promise.resolve(0));
export const mockQueueItemFindFirst = mock(() =>
  Promise.resolve(null as { id: number; status: string; errorMessage: string | null } | null),
);
export const mockQueueItemUpdateMany = mock(() => Promise.resolve({ count: 0 }));

mock.module('../../../config', () => ({
  prisma: {
    task: {
      count: mockTaskCount,
      findMany: mockTaskFindMany,
      update: mockTaskUpdate,
      findUnique: mockTaskFindUnique,
    },
    themeAutoRun: {
      updateMany: mockThemeAutoRunUpdateMany,
      count: mockThemeAutoRunCount,
    },
    workflowQueueItem: {
      findFirst: mockQueueItemFindFirst,
      updateMany: mockQueueItemUpdateMany,
    },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => ({}),
  getProjectRoot: () => '/tmp/rapitas-test',
  logger: silentLogger,
  createLogger: () => silentLogger,
}));

mock.module('../../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/rapitas-test/backend.log',
  logger: silentLogger,
  createLogger: () => silentLogger,
}));

// ---------------------------------------------------------------------------
// task-resolver mocks
// ---------------------------------------------------------------------------
export const mockResolveTaskThemeId = mock(() =>
  Promise.resolve(null as { id: number; themeId: number | null } | null),
);
export const mockResolveTaskWorkflowState = mock(() =>
  Promise.resolve(
    null as {
      id: number;
      status: string;
      workflowStatus: string | null;
      workflowMode: string | null;
      parentId: number | null;
    } | null,
  ),
);
export const mockResolveTaskWorkingDirectory = mock(() =>
  Promise.resolve(
    null as {
      themeId: number | null;
      workingDirectory: string | null;
      theme: { workingDirectory: string | null } | null;
    } | null,
  ),
);

mock.module('../../task/task-resolver', () => ({
  resolveTaskWithTheme: mock(() => Promise.resolve(null)),
  resolveTaskWithThemeAndCategory: mock(() => Promise.resolve(null)),
  resolveTaskForExecution: mock(() => Promise.resolve(null)),
  resolveTaskWorkingDirectory: mockResolveTaskWorkingDirectory,
  resolveTaskWorkflowState: mockResolveTaskWorkflowState,
  resolveTaskTitle: mock(() => Promise.resolve(null)),
  resolveTaskThemeId: mockResolveTaskThemeId,
  resolveTaskForComplexityAnalysis: mock(() => Promise.resolve(null)),
  resolveTaskSubtaskInfo: mock(() => Promise.resolve(null)),
  resolveTaskForPlanApproval: mock(() => Promise.resolve(null)),
  resolveTaskForAutoMerge: mock(() => Promise.resolve(null)),
  resolveTaskForLearning: mock(() => Promise.resolve(null)),
}));

// ---------------------------------------------------------------------------
// workflow-queue / workflow-runner / agent-worker-manager / realtime-service
// ---------------------------------------------------------------------------
export const mockEnqueue = mock(() => Promise.resolve({}));

mock.module('../workflow-queue', () => ({
  WorkflowQueueService: {
    getInstance: () => ({
      setMaxConcurrency: () => {},
      getMaxConcurrency: () => 1,
      enqueue: mockEnqueue,
      dequeue: () => Promise.resolve(null),
      updateStatus: () => Promise.resolve({}),
      retryIfPossible: () => Promise.resolve(false),
      cancel: () => Promise.resolve({}),
      updatePriority: () => Promise.resolve({}),
      getQueueState: () => Promise.resolve({}),
      getSessionItems: () => Promise.resolve([]),
      recoverStaleItems: () => Promise.resolve(0),
      findByTaskId: () => Promise.resolve(null),
    }),
  },
}));

export const mockStartProcessing = mock(() => {});

mock.module('../workflow-runner', () => ({
  WorkflowRunner: {
    getInstance: () => ({
      startProcessing: mockStartProcessing,
      stopProcessing: () => Promise.resolve(),
      abortTask: () => 0,
      getStatus: () => ({ activeItems: 0, queuedItems: 0, maxConcurrency: 1, isRunning: false }),
      resumeAfterApproval: () => Promise.resolve(true),
    }),
  },
}));

export const mockRevertChanges = mock(() => Promise.resolve(true));

mock.module('../../agents/agent-worker-manager', () => ({
  AgentWorkerManager: {
    getInstance: () => ({ revertChanges: mockRevertChanges }),
  },
}));

export const mockBroadcast = mock(() => {});

mock.module('../../communication/realtime-service', () => ({
  RealtimeService: class {},
  realtimeService: { broadcast: mockBroadcast },
}));

// ---------------------------------------------------------------------------
// backlog-task-promoter / dev-restart-on-dry / observability
// ---------------------------------------------------------------------------
export const mockHasPromotableBacklog = mock(() => Promise.resolve(false));
export const mockPromoteBacklogForTheme = mock(() => Promise.resolve(0));

mock.module('./backlog-task-promoter', () => ({
  hasPromotableBacklog: mockHasPromotableBacklog,
  promoteBacklogForTheme: mockPromoteBacklogForTheme,
}));

export const mockRecordStartupCommit = mock(() => Promise.resolve());
export const mockMaybeRestartForUpdate = mock(() => Promise.resolve(false));

mock.module('./dev-restart-on-dry', () => ({
  recordStartupCommit: mockRecordStartupCommit,
  maybeRestartForUpdate: mockMaybeRestartForUpdate,
}));

export const mockLogCycleEvent = mock(() => {});

mock.module('../../observability', () => ({
  logCycleEvent: mockLogCycleEvent,
  getCycleLogFilePath: () => '/tmp/rapitas-test/cycle.ndjson',
}));

// ---------------------------------------------------------------------------
// auto-run-selection (pure helper module) — fully replaced with controllable
// mocks so the scheduler's OWN decisions are what's under test, not selection.
// ---------------------------------------------------------------------------
export const mockGetGlobalAutoRunActiveCount = mock(() => Promise.resolve(0));
export const mockGetThemeActiveQueueItems = mock(() =>
  Promise.resolve([] as Array<{ id: number; taskId: number; status: string }>),
);
export const mockIsAwaitingUserAnswer = mock(() => Promise.resolve(false));
// Liveness check for the hang backstop — default false so existing backstop
// tests (tenure exceeded → force-stop) keep exercising the kill path.
export const mockHasLiveExecution = mock(() => Promise.resolve(false));
// 進捗時刻: 既定は「進捗なし」(=0) にして、既存のバックストップ発火テストを維持する。
export const mockResolveLastProgressAt = mock(() => Promise.resolve(0));
export const mockSelectNextTask = mock(() =>
  Promise.resolve({ found: false, reason: 'all_done' } as
    | { found: true; taskId: number }
    | { found: false; reason: 'all_done' | 'concurrency_limit' | 'awaiting_approval' }),
);

/** Test-tunable constants — kept small so cooldown/hang-backstop tests run fast. */
export const TEST_AUTO_RUN_GLOBAL_MAX_CONCURRENCY = 1;
export const TEST_POLL_INTERVAL_MS = 12_000;
export const TEST_COOLDOWN_MS = 5;
export const TEST_MAX_TASK_WALL_MS = 1_000;

mock.module('./auto-run-selection', () => ({
  AUTO_RUN_GLOBAL_MAX_CONCURRENCY: TEST_AUTO_RUN_GLOBAL_MAX_CONCURRENCY,
  POLL_INTERVAL_MS: TEST_POLL_INTERVAL_MS,
  COOLDOWN_MS: TEST_COOLDOWN_MS,
  MAX_TASK_WALL_MS: TEST_MAX_TASK_WALL_MS,
  priorityRank: (p: string | null | undefined) => (p ? 0 : 2),
  isTaskBlocked: (status: string) => status === 'blocked',
  getGlobalAutoRunActiveCount: mockGetGlobalAutoRunActiveCount,
  getThemeActiveQueueItems: mockGetThemeActiveQueueItems,
  isAwaitingUserAnswer: mockIsAwaitingUserAnswer,
  hasLiveExecution: mockHasLiveExecution,
  resolveLastProgressAt: mockResolveLastProgressAt,
  HANG_BACKSTOP_HEARTBEAT_MS: 5 * 60_000,
  selectNextTask: mockSelectNextTask,
  // R6 learnable-band signal — null means "no data", i.e. the legacy ordering.
  recentThemeSuccessRate: mock(() => Promise.resolve(null)),
  valueBandScore: () => 0,
  // Real (trivial) logic — no test needs to override "is any item waiting_approval".
  hasItemAwaitingApproval: (items: Array<{ status: string }>) =>
    items.some((i) => i.status === 'waiting_approval'),
  // Scope-overlap helpers (task 573 B) — bun mock.module must mirror EVERY
  // export. Defaults are "no overlap" so legacy scheduler tests are unaffected.
  hasScopeOverlap: () => false,
  overlappingFiles: () => [] as string[],
}));

// ---------------------------------------------------------------------------
// open-pr-files-cache (task 573 B) — no open auto-PRs by default so the
// scheduler's selection path stays on its legacy behavior in existing tests.
// ---------------------------------------------------------------------------
export const mockGetOpenAutoPrsForTheme = mock(() =>
  Promise.resolve([] as Array<{ prNumber: number; linkedTaskId: number | null }>),
);
export const mockGetPrChangedFiles = mock(() => Promise.resolve([] as string[]));

mock.module('./open-pr-files-cache', () => ({
  PR_FILES_CACHE_TTL_MS: 60_000,
  clearPrFilesCache: () => {},
  getOpenAutoPrsForTheme: mockGetOpenAutoPrsForTheme,
  getPrChangedFiles: mockGetPrChangedFiles,
}));

// ---------------------------------------------------------------------------
// merge-barrier (task 573 C) — default OFF; barrier decision mirrors the real
// pure logic so a test can flip the toggle mock and exercise the hold path.
// ---------------------------------------------------------------------------
export const mockReadMergeBarrierEnabled = mock(() => false);

mock.module('../../scheduling/merge-barrier/merge-barrier', () => ({
  MERGE_BARRIER_DEFAULT_MAX_HOLD_MS: 30 * 60 * 1000,
  getMergeBarrierMaxHoldMs: () => 30 * 60 * 1000,
  readMergeBarrierEnabled: mockReadMergeBarrierEnabled,
  writeMergeBarrierEnabled: mock(() => {}),
  shouldHoldForBarrier: (
    enabled: boolean,
    openPrExists: boolean,
    holdSinceMs: number | null,
    nowMs: number,
    maxHoldMs: number,
  ) => {
    if (!enabled || !openPrExists) return false;
    if (holdSinceMs === null) return true;
    return nowMs - holdSinceMs < maxHoldMs;
  },
}));

// ---------------------------------------------------------------------------
// theme-auto-run-service — fully replaced; the scheduler's calls into it are
// what several tests assert on directly (e.g. onTaskCompleted, setCurrentTask).
// ---------------------------------------------------------------------------
export const mockFindByStatuses = mock(() => Promise.resolve([] as ThemeAutoRunState[]));
export const mockSetCurrentTask = mock(() => Promise.resolve());
export const mockOnTaskCompleted = mock(() => Promise.resolve());
export const mockOnTaskFailed = mock(() => Promise.resolve());
export const mockOnAwaitingPlanApproval = mock(() => Promise.resolve());
export const mockResumeAutoRun = mock(() => Promise.resolve(null as ThemeAutoRunState | null));
export const mockFinalizeStop = mock(() => Promise.resolve());
export const mockGetAutoRunState = mock(() => Promise.resolve(null as ThemeAutoRunState | null));
export const mockStartAutoRun = mock(() => Promise.resolve({} as ThemeAutoRunState));

mock.module('./theme-auto-run-service', () => ({
  AUTO_RUN_STATUSES: ['idle', 'running', 'paused', 'stopping'],
  narrowAutoRunStatus: (s: string | null | undefined) => s ?? 'idle',
  isAutoRunHandlingTask: () => false,
  getOrCreateAutoRun: mock(() => Promise.resolve({})),
  getAutoRunState: mockGetAutoRunState,
  startAutoRun: mockStartAutoRun,
  pauseAutoRun: mock(() => Promise.resolve({})),
  resumeAutoRun: mockResumeAutoRun,
  stopAutoRun: mock(() => Promise.resolve({})),
  finalizeStop: mockFinalizeStop,
  setCurrentTask: mockSetCurrentTask,
  onTaskCompleted: mockOnTaskCompleted,
  onTaskFailed: mockOnTaskFailed,
  onAwaitingPlanApproval: mockOnAwaitingPlanApproval,
  isThemeAutoRunActive: mock(() => Promise.resolve(false)),
  findByStatuses: mockFindByStatuses,
}));

// ---------------------------------------------------------------------------
// auto-run-notifications
// ---------------------------------------------------------------------------
export const mockNotifyAwaitingPlanApproval = mock(() => Promise.resolve());
export const mockNotifyAwaitingUserAnswer = mock(() => Promise.resolve());
export const mockNotifyTaskSkipped = mock(() => Promise.resolve());
export const mockNotifyAllDone = mock(() => Promise.resolve());
export const mockNotifyAllBlocked = mock(() => Promise.resolve());
export const mockNotifyHangBackstop = mock(() => Promise.resolve());

mock.module('./auto-run-notifications', () => ({
  notifyAwaitingPlanApproval: mockNotifyAwaitingPlanApproval,
  notifyAwaitingUserAnswer: mockNotifyAwaitingUserAnswer,
  notifyTaskSkipped: mockNotifyTaskSkipped,
  notifyAllDone: mockNotifyAllDone,
  notifyAllBlocked: mockNotifyAllBlocked,
  notifyHangBackstop: mockNotifyHangBackstop,
}));

// ---------------------------------------------------------------------------
// auto-run-stall-guard (terminal-task residue release — task 618). Default 0 =
// "nothing released" so every legacy wait-branch test keeps its old behavior.
// ---------------------------------------------------------------------------
export const mockReleaseStaleActiveItems = mock(() => Promise.resolve(0));

mock.module('./auto-run-stall-guard', () => ({
  releaseStaleActiveItems: mockReleaseStaleActiveItems,
}));

// ---------------------------------------------------------------------------
// blocked-task-escalation (all_blocked reporting — task 615)
// ---------------------------------------------------------------------------
export const mockCountEscalatedBlocked = mock(() => Promise.resolve(0));

mock.module('../blocked-task-escalation', () => ({
  escalateBlockedTask: mock(() => Promise.resolve(false)),
  countEscalatedBlocked: mockCountEscalatedBlocked,
  BLOCKED_ESCALATED_CAUSE: 'blocked_escalated',
}));

// ---------------------------------------------------------------------------
// stop-task-agents (dynamically imported inside stopThemeExecution)
// ---------------------------------------------------------------------------
export const mockStopTaskAgents = mock(() =>
  Promise.resolve({ stoppedCount: 0, executionIds: [] }),
);
export const mockStopThemeAgents = mock(() =>
  Promise.resolve({ stoppedCount: 0, executionIds: [] }),
);

mock.module('../../agents/stop-task-agents', () => ({
  stopTaskAgents: mockStopTaskAgents,
  stopThemeAgents: mockStopThemeAgents,
}));

// ---------------------------------------------------------------------------
// Import the SUT after every dependency is mocked.
// ---------------------------------------------------------------------------
const { ThemeAutoRunScheduler } = await import('./theme-auto-run-scheduler');
export { ThemeAutoRunScheduler };

/** Shape of the scheduler's private surface used directly by these tests. */
export interface SchedulerInternal {
  running: boolean;
  tick(): Promise<void>;
  processStoppingThemes(states: ThemeAutoRunState[]): Promise<void>;
  processIdleThemes(states: ThemeAutoRunState[]): Promise<void>;
  processPausedThemes(states: ThemeAutoRunState[]): Promise<void>;
  processRunningThemes(states: ThemeAutoRunState[]): Promise<void>;
  advanceTheme(
    themeId: number,
    currentTaskId: number | null,
    order: 'priority' | 'created',
    globalActive: number,
    lastRunAt: string | null,
  ): Promise<void>;
  stopThemeExecution(themeId: number, currentTaskId: number | null): Promise<void>;
  broadcastAutoRunUpdate(themeId: number): void;
}

/** Cast a scheduler instance to expose its private methods/fields for direct testing. */
export function internal(scheduler: InstanceType<typeof ThemeAutoRunScheduler>): SchedulerInternal {
  return scheduler as unknown as SchedulerInternal;
}

/** Reset the module-level singleton so each test starts from a clean instance. */
export function resetSchedulerSingleton(): void {
  (ThemeAutoRunScheduler as unknown as { instance: unknown }).instance = undefined;
}

/** Build a minimal ThemeAutoRunState for tests. */
export function makeState(overrides: Partial<ThemeAutoRunState> = {}): ThemeAutoRunState {
  return {
    id: 1,
    themeId: 42,
    enabled: true,
    status: 'running',
    order: 'priority',
    currentTaskId: null,
    processedCount: 0,
    lastError: null,
    lastRunAt: null,
    startedAt: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Every mock declared above, for a single blanket `.mockClear()` in beforeEach. */
const ALL_MOCKS = [
  mockTaskCount,
  mockTaskFindMany,
  mockTaskUpdate,
  mockTaskFindUnique,
  mockThemeAutoRunUpdateMany,
  mockThemeAutoRunCount,
  mockQueueItemFindFirst,
  mockQueueItemUpdateMany,
  mockResolveTaskThemeId,
  mockResolveTaskWorkflowState,
  mockResolveTaskWorkingDirectory,
  mockEnqueue,
  mockStartProcessing,
  mockRevertChanges,
  mockBroadcast,
  mockHasPromotableBacklog,
  mockPromoteBacklogForTheme,
  mockRecordStartupCommit,
  mockMaybeRestartForUpdate,
  mockLogCycleEvent,
  mockGetGlobalAutoRunActiveCount,
  mockGetThemeActiveQueueItems,
  mockIsAwaitingUserAnswer,
  mockSelectNextTask,
  mockFindByStatuses,
  mockSetCurrentTask,
  mockOnTaskCompleted,
  mockOnTaskFailed,
  mockOnAwaitingPlanApproval,
  mockResumeAutoRun,
  mockFinalizeStop,
  mockGetAutoRunState,
  mockStartAutoRun,
  mockNotifyAwaitingPlanApproval,
  mockNotifyAwaitingUserAnswer,
  mockNotifyTaskSkipped,
  mockNotifyAllDone,
  mockNotifyHangBackstop,
  mockReleaseStaleActiveItems,
  mockStopTaskAgents,
  mockStopThemeAgents,
];

/** Clear call history AND restore each mock's default resolved value/behaviour. */
export function resetAllMocks(): void {
  for (const m of ALL_MOCKS) m.mockClear();
  mockTaskCount.mockResolvedValue(0);
  mockTaskFindMany.mockResolvedValue([]);
  mockTaskUpdate.mockResolvedValue({});
  mockTaskFindUnique.mockResolvedValue(null);
  mockThemeAutoRunUpdateMany.mockResolvedValue({ count: 0 });
  mockThemeAutoRunCount.mockResolvedValue(0);
  mockQueueItemFindFirst.mockResolvedValue(null);
  mockQueueItemUpdateMany.mockResolvedValue({ count: 0 });
  mockResolveTaskThemeId.mockResolvedValue(null);
  mockResolveTaskWorkflowState.mockResolvedValue(null);
  mockResolveTaskWorkingDirectory.mockResolvedValue(null);
  mockEnqueue.mockResolvedValue({});
  mockRevertChanges.mockResolvedValue(true);
  mockHasPromotableBacklog.mockResolvedValue(false);
  mockPromoteBacklogForTheme.mockResolvedValue(0);
  mockRecordStartupCommit.mockResolvedValue(undefined);
  mockMaybeRestartForUpdate.mockResolvedValue(false);
  mockGetGlobalAutoRunActiveCount.mockResolvedValue(0);
  mockGetThemeActiveQueueItems.mockResolvedValue([]);
  mockIsAwaitingUserAnswer.mockResolvedValue(false);
  mockHasLiveExecution.mockResolvedValue(false);
  mockResolveLastProgressAt.mockResolvedValue(0);
  mockSelectNextTask.mockResolvedValue({ found: false, reason: 'all_done' });
  mockFindByStatuses.mockResolvedValue([]);
  mockResumeAutoRun.mockResolvedValue(null);
  mockGetAutoRunState.mockResolvedValue(null);
  mockStartAutoRun.mockResolvedValue({} as ThemeAutoRunState);
  mockStopTaskAgents.mockResolvedValue({ stoppedCount: 0, executionIds: [] });
  mockStopThemeAgents.mockResolvedValue({ stoppedCount: 0, executionIds: [] });
  mockReleaseStaleActiveItems.mockResolvedValue(0);
}
