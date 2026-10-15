/**
 * AutoRestartBoundaryPolicy
 *
 * Pure policy layer for task-boundary self-restart governance: classifies a
 * pending merge as immediate (touches the loop machinery itself) vs boundary
 * (batched until the next task boundary), and decides wait / defer / restart
 * from a full quiescence snapshot. Not responsible for any I/O — collection
 * of inputs and execution of the restart live in index.ts.
 */

/** How urgently a pending merge must be activated. */
export type MergeUrgency = 'immediate' | 'boundary';

/** Outcome of one boundary-restart evaluation. */
export type BoundaryRestartAction = 'wait' | 'defer' | 'restart';

/** Inputs for one boundary-restart gate evaluation. */
export interface BoundaryRestartInput {
  /** Commits on origin/<branch> ahead of the commit this process booted on. */
  aheadCount: number;
  /** Whether a shutdown is already in progress (another restart path won). */
  isShuttingDown: boolean;
  /** Live in-process agent executions (orchestrator count). */
  activeExecutions: number;
  /** DB rows claiming running/pending executions. */
  runningExecutions: number;
  /** Queued auto-run workflow items. */
  queueDepth: number;
  /** Tracked auxiliary AI CLI child processes still alive (concern #1284). */
  auxChildren: number;
  /** Whether the auto-merge watcher is mid-tick (merge processing). */
  isMerging: boolean;
  /** ms since the last merged-code restart, or null when none has ever fired. */
  msSinceLastRestart: number | null;
  /** Minimum ms required between boundary restarts. */
  minRestartIntervalMs: number;
  /** ms since the last UI-originated API request, or null when never recorded. */
  msSinceLastUiActivity: number | null;
  /** Window within which the user counts as actively using the UI. */
  uiQuietMs: number;
  /** Consecutive UI-activity deferrals accumulated so far. */
  deferCount: number;
  /** Deferral ceiling; reaching it forces the restart despite UI activity. */
  maxDeferrals: number;
}

/** Result of one boundary-restart gate evaluation. */
export interface BoundaryRestartDecision {
  /** wait = system busy (retry next boundary), defer = UI active, restart = go. */
  action: BoundaryRestartAction;
  /** The first gate that failed, or 'ok' when all passed. */
  reason: string;
  /** Defer count to persist: unchanged on wait, +1 on defer, 0 on restart. */
  nextDeferCount: number;
}

// Loop-machinery path fragments (matched as substrings after normalization).
// A merge touching any of these may itself fix the boundary/restart loop, so
// waiting for a boundary that might never come is unsafe — restart immediately.
// services/agents/ is deliberately NOT listed: including it would reclassify
// most merges as immediate and reintroduce the per-merge restart churn this
// policy exists to remove.
const LOOP_MACHINERY_FRAGMENTS = [
  'services/workflow/',
  'services/scheduling/',
  'auto-run/',
  'auto-merge',
  'shutdown-sequence',
  'scripts/restart',
  'restart-loop-smoke',
] as const;

/** Normalize a repo path for matching: lowercase, `\`→`/`, strip leading `./`. */
function normalizePath(path: string): string {
  let normalized = path.trim().toLowerCase().replace(/\\/g, '/');
  while (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }
  return normalized;
}

/**
 * Classify a pending merge by its changed file paths: immediate when any path
 * touches the loop machinery, boundary otherwise.
 *
 * Empty / unknown change sets classify as boundary — when we cannot tell what
 * a merge contains, waiting for the next boundary is the safe side (an
 * unnecessary immediate restart is the failure mode this task removes).
 *
 * @param changedPaths - Changed file paths of the pending merge, or null/undefined when unknown / 変更ファイルパス（不明時はnull）
 * @returns 'immediate' when loop machinery is touched, else 'boundary' / 機構変更ならimmediate、それ以外はboundary
 */
export function classifyMergeUrgency(
  changedPaths: readonly string[] | null | undefined,
): MergeUrgency {
  if (!changedPaths || changedPaths.length === 0) return 'boundary';
  for (const raw of changedPaths) {
    const path = normalizePath(raw);
    if (!path) continue;
    // dev.js is matched as a basename (not a bare substring) so unrelated
    // files that merely end in "dev.js" (e.g. somedev.js) never classify.
    if (path === 'dev.js' || path.endsWith('/dev.js')) return 'immediate';
    if (LOOP_MACHINERY_FRAGMENTS.some((fragment) => path.includes(fragment))) return 'immediate';
  }
  return 'boundary';
}

/**
 * Evaluate all boundary-restart quiescence gates in order and report the
 * first failure. Order: unactivated commits → shutdown in progress → active
 * executions → running executions → queue depth → aux CLI children →
 * auto-merge in progress → rate limit → UI activity (defer) → restart.
 *
 * System-busy waits (conditions a–d) keep the defer count unchanged — they
 * are transient states, not user protection. Only a UI-activity deferral
 * increments the count; hitting the ceiling forces the restart so an idle
 * open UI can never block activation forever.
 *
 * @param input - Snapshot of all gate inputs / 全ゲート入力のスナップショット
 * @returns Decision with action, first failing gate, and next defer count / 判定・失敗ゲート・次回先送りカウント
 */
export function decideBoundaryRestart(input: BoundaryRestartInput): BoundaryRestartDecision {
  const wait = (reason: string): BoundaryRestartDecision => ({
    action: 'wait',
    reason,
    nextDeferCount: input.deferCount,
  });
  if (input.aheadCount <= 0) return wait('no-unactivated-commits');
  if (input.isShuttingDown) return wait('already-shutting-down');
  if (input.activeExecutions > 0) return wait('active-executions');
  if (input.runningExecutions > 0) return wait('running-executions');
  if (input.queueDepth > 0) return wait('queue-not-empty');
  if (input.auxChildren > 0) return wait('aux-cli-children-alive');
  if (input.isMerging) return wait('auto-merge-in-progress');
  if (input.msSinceLastRestart !== null && input.msSinceLastRestart < input.minRestartIntervalMs) {
    return wait('rate-limited');
  }
  // null = no UI request ever recorded → quiet (fail-open: the frontend does
  // not send the header yet; the restart must still proceed normally).
  const uiActive =
    input.msSinceLastUiActivity !== null && input.msSinceLastUiActivity < input.uiQuietMs;
  if (uiActive) {
    if (input.deferCount < input.maxDeferrals) {
      return {
        action: 'defer',
        reason: 'ui-active-deferred',
        nextDeferCount: input.deferCount + 1,
      };
    }
    return { action: 'restart', reason: 'ui-active-forced', nextDeferCount: 0 };
  }
  return { action: 'restart', reason: 'ok', nextDeferCount: 0 };
}

/** Parse a positive-integer env var, falling back on absent/invalid values. */
function resolvePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// 10 min — boundary-path flapping guard. Independent from the poller's
// RAPITAS_AUTO_RESTART_MERGED_CODE_MIN_INTERVAL_MS (30 min) and dev-restart's
// fixed 10 min; the boundary path is governed by its own explicit env.
const DEFAULT_MIN_RESTART_INTERVAL_MS = 10 * 60 * 1000;
// 3 min — how recently a UI request must have arrived to count as "in use".
const DEFAULT_UI_QUIET_MS = 3 * 60 * 1000;
// 5 — deferral ceiling before the restart fires despite UI activity.
const DEFAULT_MAX_DEFERRALS = 5;

/**
 * Resolve the minimum interval between boundary restarts.
 *
 * @returns Interval in ms (RAPITAS_RESTART_MIN_INTERVAL_MS, default 10 min) / 最低再起動間隔（ミリ秒）
 */
export function resolveRestartMinIntervalMs(): number {
  return resolvePositiveIntEnv('RAPITAS_RESTART_MIN_INTERVAL_MS', DEFAULT_MIN_RESTART_INTERVAL_MS);
}

/**
 * Resolve the UI-quiet window for the boundary restart.
 *
 * @returns Window in ms (RAPITAS_RESTART_UI_QUIET_MS, default 3 min) / UI静穏窓（ミリ秒）
 */
export function resolveRestartUiQuietMs(): number {
  return resolvePositiveIntEnv('RAPITAS_RESTART_UI_QUIET_MS', DEFAULT_UI_QUIET_MS);
}

/**
 * Resolve the UI-activity deferral ceiling. Unlike the interval envs, 0 is a
 * valid value (= never defer, restart as soon as the system is quiescent).
 *
 * @returns Deferral ceiling (RAPITAS_RESTART_MAX_DEFERRALS, default 5) / 先送り上限回数
 */
export function resolveRestartMaxDeferrals(): number {
  const raw = process.env.RAPITAS_RESTART_MAX_DEFERRALS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_DEFERRALS;
}
