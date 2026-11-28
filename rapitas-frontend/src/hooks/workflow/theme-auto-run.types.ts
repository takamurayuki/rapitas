/**
 * theme-auto-run.types
 *
 * Response shapes of GET /themes/:id/auto-run, split out of useThemeAutoRun.ts
 * (file size). The hook re-exports them, so existing imports are unchanged.
 */

export type AutoRunStatus = 'idle' | 'running' | 'paused' | 'stopping';

export interface ThemeAutoRunState {
  id: number;
  themeId: number;
  enabled: boolean;
  status: AutoRunStatus;
  order: 'priority' | 'created';
  currentTaskId: number | null;
  processedCount: number;
  lastError: string | null;
  lastRunAt: string | null;
  startedAt: string | null;
  updatedAt: string;
}

/** The task auto-run is working on, as the state endpoint returns it. */
export interface CurrentTask {
  id: number;
  title: string;
  status: string;
  workflowStatus: string | null;
  /** lightweight / standard / comprehensive; absent from older backends. */
  workflowMode?: string | null;
  /** Send-backs to an earlier phase, or null when none. */
  rework?: ReworkSummary | null;
  /**
   * Other tasks of the theme running in parallel with this one (task 1552),
   * copied from the response's `activeTasks`; absent or empty = one at a time.
   */
  companions?: ActiveTask[];
}

/** One running task of the theme, head first (task 1552). */
export interface ActiveTask {
  id: number;
  title: string;
  /** `head` = currentTask, `companion` = a 2nd+ task running alongside it. */
  role: 'head' | 'companion';
}

/** How often the task was sent back, and the most recent send-back. */
export interface ReworkSummary {
  count: number;
  lastFromStatus: string;
  lastToStatus: string;
  lastCause: string;
  lastAt: string;
}

/** A task that gave its slot back while it waits for CI / its required merge. */
export interface AwaitingCiEntry {
  taskId: number;
  title: string;
  /** Latest workflow transition cause. */
  cause: string;
  since: string;
}

/** Auto-run state plus the current task and the remaining backlog count. */
export interface AutoRunData {
  autoRun: ThemeAutoRunState;
  currentTask: CurrentTask | null;
  remainingCount: number;
  /** Every running task of the theme (task 1552); absent from older backends. */
  activeTasks?: ActiveTask[];
  /** True while auto-run starts no new work until merged code activates (task 1562). */
  restartWait?: boolean;
  /** Updates waiting to activate; null when unknown. / 取り込み待ちの件数 */
  pendingUpdateCount?: number | null;
  /** Tasks waiting for CI without a slot, also while idle; absent from older backends. */
  awaitingCi?: AwaitingCiEntry[];
}
