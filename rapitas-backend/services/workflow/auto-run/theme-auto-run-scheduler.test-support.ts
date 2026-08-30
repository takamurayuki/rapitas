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
 * This file is a barrel: the actual mock.module() definitions live in the
 * sibling `.collaborator-mocks.ts` (data/infra collaborators) and
 * `.decision-mocks.ts` (the scheduler's own decision-layer collaborators)
 * files — split out under task 765 to stay under the file-size ratchet. New
 * mock.module() definitions belong in one of those two files, not here. This
 * file only re-exports them, imports the SUT after they've run, and defines
 * the test-harness helpers (`internal`, `resetSchedulerSingleton`, `makeState`,
 * `resetAllMocks`) that operate across both groups.
 */
export * from './theme-auto-run-scheduler.test-support.collaborator-mocks';
export * from './theme-auto-run-scheduler.test-support.decision-mocks';

import type { ThemeAutoRunState } from './theme-auto-run-service';

import {
  mockTaskCount,
  mockTaskFindMany,
  mockTaskUpdate,
  mockTransitionCount,
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
  mockRecordTransition,
  mockLogCycleEvent,
  mockStopTaskAgents,
  mockStopThemeAgents,
  mockActivityLogCreate,
} from './theme-auto-run-scheduler.test-support.collaborator-mocks';
import {
  mockGetGlobalAutoRunActiveCount,
  mockGetThemeActiveQueueItems,
  mockIsAwaitingUserAnswer,
  mockHasLiveExecution,
  mockResolveLastProgressAt,
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
  mockNotifyTaskVanished,
  mockNotifyResourceContentionHold,
  mockGetHostCpuBusyPercent,
  mockEvaluateResourceGate,
  mockConsumeResourceGateOverride,
  mockRequestResourceGateOverride,
  mockReleaseStaleActiveItems,
} from './theme-auto-run-scheduler.test-support.decision-mocks';

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
  mockTransitionCount,
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
  mockRecordTransition,
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
  mockNotifyTaskVanished,
  mockReleaseStaleActiveItems,
  mockStopTaskAgents,
  mockStopThemeAgents,
  mockActivityLogCreate,
  mockNotifyResourceContentionHold,
  mockGetHostCpuBusyPercent,
  mockEvaluateResourceGate,
  mockConsumeResourceGateOverride,
  mockRequestResourceGateOverride,
];

/** Clear call history AND restore each mock's default resolved value/behaviour. */
export function resetAllMocks(): void {
  for (const m of ALL_MOCKS) m.mockClear();
  mockTaskCount.mockResolvedValue(0);
  mockTaskFindMany.mockResolvedValue([]);
  mockTaskUpdate.mockResolvedValue({});
  mockTransitionCount.mockResolvedValue(0);
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
  mockActivityLogCreate.mockResolvedValue({});
  mockNotifyResourceContentionHold.mockResolvedValue(undefined);
  mockGetHostCpuBusyPercent.mockReturnValue(null);
  mockEvaluateResourceGate.mockReturnValue({
    hold: false,
    cpuBusyPercent: null,
    thresholdPercent: 85,
    effectiveMaxConcurrency: 1,
  });
  mockConsumeResourceGateOverride.mockReturnValue(false);
}
