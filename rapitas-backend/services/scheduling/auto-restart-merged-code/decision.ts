/**
 * AutoRestartMergedCodeDecision
 *
 * Pure gate evaluation for the merged-but-inactive-code auto-restart: decides
 * whether a restart may fire given the current system snapshot and settings.
 * Not responsible for any I/O (git, files, notifications) — see index.ts.
 */

/** Inputs for one auto-restart gate evaluation. */
export interface AutoRestartDecisionInput {
  /** Commits on origin/<branch> ahead of the commit this process booted on. */
  aheadCount: number;
  /** Live in-process agent executions (orchestrator count). */
  activeExecutions: number;
  /** DB rows claiming running/pending executions. */
  runningExecutions: number;
  /** Queued auto-run workflow items. */
  queueDepth: number;
  /** Whether a shutdown is already in progress (another restart path won). */
  isShuttingDown: boolean;
  /** The autoRestartOnMergedCode toggle (default OFF = safe side). */
  settingEnabled: boolean;
  /** ms since the last auto-restart, or null when none has ever fired. */
  msSinceLastRestart: number | null;
  /** Minimum ms required between auto-restarts (flapping guard). */
  minRestartIntervalMs: number;
}

/** Result of one gate evaluation. */
export interface AutoRestartDecision {
  /** Whether all gates passed and a restart may fire. */
  shouldRestart: boolean;
  /** The first gate that failed, or 'ok' when all passed. */
  reason: string;
}

/**
 * Evaluate all auto-restart gates in order and report the first failure.
 * Gate order: toggle → unactivated commits → shutdown in progress → active
 * executions → running executions → queue depth → rate limit.
 *
 * @param input - Snapshot of all gate inputs / 全ゲート入力のスナップショット
 * @returns Decision with the first failing gate as reason / 最初に失敗したゲートを理由に含む判定
 */
export function decideAutoRestart(input: AutoRestartDecisionInput): AutoRestartDecision {
  if (!input.settingEnabled) {
    return { shouldRestart: false, reason: 'setting-disabled' };
  }
  if (input.aheadCount <= 0) {
    return { shouldRestart: false, reason: 'no-unactivated-commits' };
  }
  if (input.isShuttingDown) {
    return { shouldRestart: false, reason: 'already-shutting-down' };
  }
  if (input.activeExecutions > 0) {
    return { shouldRestart: false, reason: 'active-executions' };
  }
  if (input.runningExecutions > 0) {
    return { shouldRestart: false, reason: 'running-executions' };
  }
  if (input.queueDepth > 0) {
    return { shouldRestart: false, reason: 'queue-not-empty' };
  }
  if (input.msSinceLastRestart !== null && input.msSinceLastRestart < input.minRestartIntervalMs) {
    return { shouldRestart: false, reason: 'rate-limited' };
  }
  return { shouldRestart: true, reason: 'ok' };
}
