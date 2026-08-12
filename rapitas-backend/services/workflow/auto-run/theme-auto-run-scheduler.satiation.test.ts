/**
 * theme-auto-run-scheduler.satiation.test
 *
 * Covers the 飽和完了 (satiated) trigger wired into advanceTheme's all_done
 * branch (要求B): dry-cycle counting via satiation-tracker, the 2-cycle
 * notification with the value-gate exclusion breakdown, the unmerged-repair-PR
 * and toggle guards, chain resets on task selection / successful promotion,
 * and the auto-resume signals through processIdleThemes. Timers and DB are
 * mocked (受入基準2).
 *
 * NOTE: standalone mock scaffolding (mirrors theme-auto-run-scheduler.
 * test-support.ts) instead of importing it — the shared file's promoter/
 * notification factories lack the satiation-era exports, and bun's module-mock
 * registry fixes a module's mock at its first instantiation, so they cannot be
 * extended from a sibling file after the fact. bunfig `isolate = true` keeps
 * this registry per-file, so the duplication never leaks into other suites.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type { ThemeAutoRunState } from './theme-auto-run-service';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// --- config / logger ---------------------------------------------------------
const mockTaskCount = mock(() => Promise.resolve(0));
const mockTaskFindMany = mock(() => Promise.resolve([] as Array<{ id: number }>));
const mockTaskUpdate = mock(() => Promise.resolve({}));
const mockTaskFindUnique = mock(() => Promise.resolve(null as { workflowStatus: string } | null));
const mockThemeAutoRunUpdateMany = mock(() => Promise.resolve({ count: 0 }));

mock.module('../../../config', () => ({
  prisma: {
    task: {
      count: mockTaskCount,
      findMany: mockTaskFindMany,
      update: mockTaskUpdate,
      findUnique: mockTaskFindUnique,
    },
    themeAutoRun: { updateMany: mockThemeAutoRunUpdateMany, count: mock(() => Promise.resolve(0)) },
    workflowQueueItem: {
      findFirst: mock(() => Promise.resolve(null)),
      updateMany: mock(() => Promise.resolve({ count: 0 })),
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

// --- task-resolver / queue / runner / worker / realtime ----------------------
mock.module('../../task/task-resolver', () => ({
  resolveTaskWithTheme: mock(() => Promise.resolve(null)),
  resolveTaskWithThemeAndCategory: mock(() => Promise.resolve(null)),
  resolveTaskForExecution: mock(() => Promise.resolve(null)),
  resolveTaskWorkingDirectory: mock(() => Promise.resolve(null)),
  resolveTaskWorkflowState: mock(() => Promise.resolve(null)),
  resolveTaskTitle: mock(() => Promise.resolve(null)),
  resolveTaskThemeId: mock(() => Promise.resolve(null)),
  resolveTaskForComplexityAnalysis: mock(() => Promise.resolve(null)),
  resolveTaskSubtaskInfo: mock(() => Promise.resolve(null)),
  resolveTaskForPlanApproval: mock(() => Promise.resolve(null)),
  resolveTaskForAutoMerge: mock(() => Promise.resolve(null)),
  resolveTaskForLearning: mock(() => Promise.resolve(null)),
}));

const mockEnqueue = mock(() => Promise.resolve({}));

mock.module('../workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => ({ enqueue: mockEnqueue }) },
}));

mock.module('../workflow-runner', () => ({
  WorkflowRunner: { getInstance: () => ({ startProcessing: mock(() => {}) }) },
}));

mock.module('../../agents/agent-worker-manager', () => ({
  AgentWorkerManager: {
    getInstance: () => ({ revertChanges: mock(() => Promise.resolve(true)) }),
  },
}));

mock.module('../../communication/realtime-service', () => ({
  RealtimeService: class {},
  realtimeService: { broadcast: mock(() => {}) },
}));

mock.module('../../agents/stop-task-agents', () => ({
  stopTaskAgents: mock(() => Promise.resolve({ stoppedCount: 0, executionIds: [] })),
  stopThemeAgents: mock(() => Promise.resolve({ stoppedCount: 0, executionIds: [] })),
}));

// --- promoter (incl. the satiation-era exports under test) -------------------
interface GatedResult {
  passed: Array<{ id: number }>;
  rejected: Array<{ concern: { title: string }; reason: string }>;
  gateEnabled: boolean;
}

const mockHasPromotableBacklog = mock(() => Promise.resolve(false));
const mockPromoteBacklogForTheme = mock(() => Promise.resolve(0));
const mockComputePromotableConcerns = mock(() =>
  Promise.resolve<GatedResult>({ passed: [], rejected: [], gateEnabled: true }),
);
const mockHasUnmergedRepairPr = mock(() => Promise.resolve(false));

mock.module('./backlog-task-promoter', () => ({
  hasPromotableBacklog: mockHasPromotableBacklog,
  promoteBacklogForTheme: mockPromoteBacklogForTheme,
  computePromotableConcerns: mockComputePromotableConcerns,
  hasUnmergedRepairPr: mockHasUnmergedRepairPr,
}));

// --- dev-restart / observability --------------------------------------------
mock.module('./dev-restart-on-dry', () => ({
  recordStartupCommit: mock(() => Promise.resolve()),
  maybeRestartForUpdate: mock(() => Promise.resolve(false)),
}));

const mockLogCycleEvent = mock(() => {});

mock.module('../../observability', () => ({
  logCycleEvent: mockLogCycleEvent,
  getCycleLogFilePath: () => '/tmp/rapitas-test/cycle.ndjson',
}));

// --- auto-run-selection ------------------------------------------------------
const mockSelectNextTask = mock(() =>
  Promise.resolve({ found: false, reason: 'all_done' } as
    | { found: true; taskId: number }
    | { found: false; reason: 'all_done' | 'concurrency_limit' | 'awaiting_approval' }),
);

mock.module('./auto-run-selection', () => ({
  AUTO_RUN_GLOBAL_MAX_CONCURRENCY: 1,
  POLL_INTERVAL_MS: 12_000,
  COOLDOWN_MS: 5,
  MAX_TASK_WALL_MS: 1_000,
  priorityRank: () => 0,
  isTaskBlocked: (status: string) => status === 'blocked',
  getGlobalAutoRunActiveCount: mock(() => Promise.resolve(0)),
  getThemeActiveQueueItems: mock(() => Promise.resolve([])),
  isAwaitingUserAnswer: mock(() => Promise.resolve(false)),
  selectNextTask: mockSelectNextTask,
  recentThemeSuccessRate: mock(() => Promise.resolve(null)),
  valueBandScore: () => 0,
  hasItemAwaitingApproval: (items: Array<{ status: string }>) =>
    items.some((i) => i.status === 'waiting_approval'),
}));

// --- theme-auto-run-service --------------------------------------------------
const mockStartAutoRun = mock(() => Promise.resolve({} as ThemeAutoRunState));

mock.module('./theme-auto-run-service', () => ({
  AUTO_RUN_STATUSES: ['idle', 'running', 'paused', 'stopping'],
  narrowAutoRunStatus: (s: string | null | undefined) => s ?? 'idle',
  isAutoRunHandlingTask: () => false,
  getOrCreateAutoRun: mock(() => Promise.resolve({})),
  getAutoRunState: mock(() => Promise.resolve(null)),
  startAutoRun: mockStartAutoRun,
  pauseAutoRun: mock(() => Promise.resolve({})),
  resumeAutoRun: mock(() => Promise.resolve(null)),
  stopAutoRun: mock(() => Promise.resolve({})),
  finalizeStop: mock(() => Promise.resolve()),
  setCurrentTask: mock(() => Promise.resolve()),
  onTaskCompleted: mock(() => Promise.resolve()),
  onTaskFailed: mock(() => Promise.resolve()),
  onAwaitingPlanApproval: mock(() => Promise.resolve()),
  isThemeAutoRunActive: mock(() => Promise.resolve(false)),
  findByStatuses: mock(() => Promise.resolve([])),
}));

// --- notifications (incl. notifySatiated) ------------------------------------
const mockNotifyAllDone = mock(() => Promise.resolve());
const mockNotifySatiated = mock((_themeId: number, _breakdown: unknown) => Promise.resolve());

mock.module('./auto-run-notifications', () => ({
  notifyAwaitingPlanApproval: mock(() => Promise.resolve()),
  notifyAwaitingUserAnswer: mock(() => Promise.resolve()),
  notifyTaskSkipped: mock(() => Promise.resolve()),
  notifyAllDone: mockNotifyAllDone,
  notifyHangBackstop: mock(() => Promise.resolve()),
  notifySatiated: mockNotifySatiated,
}));

// --- satiation tracker + value gate toggle (dynamic imports in the SUT) ------
const mockRecordDryCycle = mock(() => ({ dryCycles: 1, justSatiated: false }));
const mockResetSatiation = mock((_themeId: number) => {});
const mockReadValueGateEnabled = mock(() => true);

mock.module('./satiation-tracker', () => ({
  SATIATION_DRY_CYCLE_THRESHOLD: 2,
  recordDryCycle: mockRecordDryCycle,
  resetSatiation: mockResetSatiation,
  isSatiated: mock(() => false),
}));

mock.module('./value-gate-settings-store', () => ({
  readValueGateEnabled: mockReadValueGateEnabled,
  writeValueGateEnabled: mock(() => {}),
}));

// --- SUT (imported after every dependency is mocked) -------------------------
const { ThemeAutoRunScheduler } = await import('./theme-auto-run-scheduler');

interface SchedulerInternal {
  advanceTheme(
    themeId: number,
    currentTaskId: number | null,
    order: 'priority' | 'created',
    globalActive: number,
    lastRunAt: string | null,
  ): Promise<void>;
  processIdleThemes(states: ThemeAutoRunState[]): Promise<void>;
}

function internal(s: InstanceType<typeof ThemeAutoRunScheduler>): SchedulerInternal {
  return s as unknown as SchedulerInternal;
}

function makeIdleArmedState(themeId: number): ThemeAutoRunState {
  return {
    id: 1,
    themeId,
    enabled: true,
    status: 'idle',
    order: 'priority',
    currentTaskId: null,
    processedCount: 0,
    lastError: null,
    lastRunAt: null,
    startedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

let scheduler: InstanceType<typeof ThemeAutoRunScheduler>;

beforeEach(() => {
  for (const m of [
    mockTaskCount,
    mockTaskFindMany,
    mockTaskUpdate,
    mockTaskFindUnique,
    mockThemeAutoRunUpdateMany,
    mockEnqueue,
    mockHasPromotableBacklog,
    mockPromoteBacklogForTheme,
    mockComputePromotableConcerns,
    mockHasUnmergedRepairPr,
    mockLogCycleEvent,
    mockSelectNextTask,
    mockStartAutoRun,
    mockNotifyAllDone,
    mockNotifySatiated,
    mockRecordDryCycle,
    mockResetSatiation,
    mockReadValueGateEnabled,
  ]) {
    m.mockReset();
  }
  mockTaskCount.mockResolvedValue(0);
  mockTaskFindMany.mockResolvedValue([]);
  mockTaskUpdate.mockResolvedValue({});
  mockTaskFindUnique.mockResolvedValue(null);
  mockThemeAutoRunUpdateMany.mockResolvedValue({ count: 0 });
  mockEnqueue.mockResolvedValue({});
  mockHasPromotableBacklog.mockResolvedValue(false);
  mockPromoteBacklogForTheme.mockResolvedValue(0);
  mockComputePromotableConcerns.mockResolvedValue({ passed: [], rejected: [], gateEnabled: true });
  mockHasUnmergedRepairPr.mockResolvedValue(false);
  mockSelectNextTask.mockResolvedValue({ found: false, reason: 'all_done' });
  mockStartAutoRun.mockResolvedValue({} as ThemeAutoRunState);
  mockNotifyAllDone.mockResolvedValue(undefined);
  mockNotifySatiated.mockResolvedValue(undefined);
  mockRecordDryCycle.mockReturnValue({ dryCycles: 1, justSatiated: false });
  mockReadValueGateEnabled.mockReturnValue(true);
  (ThemeAutoRunScheduler as unknown as { instance: unknown }).instance = undefined;
  scheduler = ThemeAutoRunScheduler.getInstance();
});

/** Drive one dry all_done pass (no task found, promotion yields nothing). */
async function runDryPass(themeId = 1): Promise<void> {
  await internal(scheduler).advanceTheme(themeId, null, 'priority', 0, null);
}

describe('all_done dry pass — satiation counting', () => {
  it('the 1st dry cycle stays non-satiated: legacy notifyAllDone, no satiated notify', async () => {
    mockRecordDryCycle.mockReturnValue({ dryCycles: 1, justSatiated: false });

    await runDryPass();

    expect(mockRecordDryCycle).toHaveBeenCalledWith(1);
    expect(mockNotifySatiated).not.toHaveBeenCalled();
    expect(mockNotifyAllDone).toHaveBeenCalledWith(1);
    // Still parks idle-but-armed (static quiescence is unchanged).
    expect(mockThemeAutoRunUpdateMany).toHaveBeenCalledWith({
      where: { themeId: 1 },
      data: { status: 'idle', enabled: true, currentTaskId: null },
    });
  });

  it('the 2nd consecutive dry cycle sends ONE satiated notification with the breakdown and suppresses notifyAllDone', async () => {
    mockRecordDryCycle.mockReturnValue({ dryCycles: 2, justSatiated: true });
    mockComputePromotableConcerns.mockResolvedValue({
      passed: [],
      rejected: [
        { concern: { title: 'ログ収穫A' }, reason: 'source_quota' },
        { concern: { title: 'ログ収穫B' }, reason: 'source_quota' },
        { concern: { title: '曖昧な懸念' }, reason: 'no_evidence' },
      ],
      gateEnabled: true,
    });

    await runDryPass();

    expect(mockNotifySatiated).toHaveBeenCalledTimes(1);
    const [themeId, breakdown] = mockNotifySatiated.mock.calls[0] as [
      number,
      Array<{ reason: string; count: number; examples: string[] }>,
    ];
    expect(themeId).toBe(1);
    expect(breakdown).toEqual([
      { reason: 'source_quota', count: 2, examples: ['ログ収穫A', 'ログ収穫B'] },
      { reason: 'no_evidence', count: 1, examples: ['曖昧な懸念'] },
    ]);
    expect(mockNotifyAllDone).not.toHaveBeenCalled();
    expect(mockLogCycleEvent).toHaveBeenCalledWith(
      'satiation.entered',
      expect.objectContaining({ theme: 1, dryCycles: 2 }),
    );
  });

  it('later dry cycles while already satiated stay silent (no re-notify, no notifyAllDone)', async () => {
    mockRecordDryCycle.mockReturnValue({ dryCycles: 3, justSatiated: false });

    await runDryPass();

    expect(mockNotifySatiated).not.toHaveBeenCalled();
    expect(mockNotifyAllDone).not.toHaveBeenCalled();
  });

  it('a failing breakdown computation still notifies (empty breakdown, never blocks)', async () => {
    mockRecordDryCycle.mockReturnValue({ dryCycles: 2, justSatiated: true });
    mockComputePromotableConcerns.mockRejectedValue(new Error('db down'));

    await runDryPass();

    expect(mockNotifySatiated).toHaveBeenCalledWith(1, []);
  });
});

describe('all_done dry pass — guards', () => {
  it('an unmerged repair PR resets the chain instead of counting a dry cycle', async () => {
    mockHasUnmergedRepairPr.mockResolvedValue(true);

    await runDryPass();

    expect(mockRecordDryCycle).not.toHaveBeenCalled();
    expect(mockResetSatiation).toHaveBeenCalledWith(1);
    expect(mockNotifySatiated).not.toHaveBeenCalled();
    expect(mockNotifyAllDone).toHaveBeenCalledWith(1);
  });

  it('toggle OFF skips satiation entirely and falls back to the legacy notify (旧挙動)', async () => {
    mockReadValueGateEnabled.mockReturnValue(false);

    await runDryPass();

    expect(mockRecordDryCycle).not.toHaveBeenCalled();
    expect(mockNotifySatiated).not.toHaveBeenCalled();
    expect(mockNotifyAllDone).toHaveBeenCalledWith(1);
  });

  it('a throwing satiation evaluation falls back to notifyAllDone (never breaks the tick)', async () => {
    mockHasUnmergedRepairPr.mockRejectedValue(new Error('boom'));

    await runDryPass();

    expect(mockNotifyAllDone).toHaveBeenCalledWith(1);
  });
});

describe('chain resets', () => {
  it('selecting a real task resets the satiation chain', async () => {
    mockSelectNextTask.mockResolvedValue({ found: true, taskId: 77 });

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockResetSatiation).toHaveBeenCalledWith(1);
    expect(mockEnqueue).toHaveBeenCalled();
    expect(mockRecordDryCycle).not.toHaveBeenCalled();
  });

  it('a promotion that creates tasks resets the chain and stays active', async () => {
    mockPromoteBacklogForTheme.mockResolvedValue(2);

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockResetSatiation).toHaveBeenCalledWith(1);
    expect(mockRecordDryCycle).not.toHaveBeenCalled();
    expect(mockNotifySatiated).not.toHaveBeenCalled();
  });
});

describe('auto-resume signals while satiated (idle-armed)', () => {
  it('a user-filed todo task resumes the theme', async () => {
    mockTaskCount.mockResolvedValue(1); // todo > 0 (ユーザー起票)
    mockHasPromotableBacklog.mockResolvedValue(false);

    await internal(scheduler).processIdleThemes([makeIdleArmedState(1)]);

    expect(mockStartAutoRun).toHaveBeenCalledWith(1);
  });

  it('a gate-passing concern (e.g. CI赤のci_watch懸念) resumes the theme', async () => {
    mockTaskCount.mockResolvedValue(0);
    mockHasPromotableBacklog.mockResolvedValue(true); // value gate passed

    await internal(scheduler).processIdleThemes([makeIdleArmedState(1)]);

    expect(mockStartAutoRun).toHaveBeenCalledWith(1);
  });

  it('gate-rejected-only backlog does NOT resume the theme (stays quiescent)', async () => {
    mockTaskCount.mockResolvedValue(0);
    mockHasPromotableBacklog.mockResolvedValue(false); // gated: rejected-only

    await internal(scheduler).processIdleThemes([makeIdleArmedState(1)]);

    expect(mockStartAutoRun).not.toHaveBeenCalled();
  });
});
