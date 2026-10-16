/**
 * DecisionTraceConsistencyScheduler
 *
 * Periodic scheduler for the asynchronous decision-audit consistency check
 * (services/observability/decision-trace/consistency-checker.ts). Runs every
 * 20 minutes by default; override via RAPITAS_DECISION_CONSISTENCY_INTERVAL_MS.
 * Mirrors the WorktreeCleanupScheduler pattern (start/stop, immediate first
 * run + setInterval, never throws out of a cycle).
 */

import { createLogger } from '../../config/logger';
import { runConsistencyCheckBatch } from '../observability/decision-trace';

const logger = createLogger('decision-trace-consistency-scheduler');

// 20 min — slightly tighter than worktree cleanup (30 min) because audit
// freshness matters more than worktree hygiene.
const DEFAULT_INTERVAL_MS = 20 * 60 * 1000;

/**
 * Resolves the check interval from the environment.
 *
 * @returns Interval in milliseconds / チェック間隔（ミリ秒）
 */
function resolveIntervalMs(): number {
  const raw = process.env.RAPITAS_DECISION_CONSISTENCY_INTERVAL_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
}

export class DecisionTraceConsistencyScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start the periodic consistency-check scheduler.
   *
   * @param intervalMs - Check interval in milliseconds (defaults to env / 20 min) / チェック間隔（ミリ秒）
   */
  start(intervalMs?: number): void {
    if (this.isRunning) {
      logger.warn('[DecisionTraceConsistencyScheduler] Already running, ignoring start request');
      return;
    }

    const interval = intervalMs ?? resolveIntervalMs();
    logger.info(
      `[DecisionTraceConsistencyScheduler] Starting scheduler with ${interval}ms interval`,
    );
    this.isRunning = true;

    // Run an initial check immediately so restarts don't delay verdicts a full interval.
    this.runOnce().catch((error) => {
      logger.error({ err: error }, '[DecisionTraceConsistencyScheduler] Initial check failed');
    });

    this.intervalId = setInterval(() => {
      this.runOnce().catch((error) => {
        logger.error({ err: error }, '[DecisionTraceConsistencyScheduler] Scheduled check failed');
      });
    }, interval);
  }

  /**
   * Stop the periodic consistency-check scheduler.
   */
  stop(): void {
    if (!this.isRunning) {
      logger.debug('[DecisionTraceConsistencyScheduler] Not running, ignoring stop request');
      return;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('[DecisionTraceConsistencyScheduler] Stopped');
  }

  /**
   * Check if the scheduler is currently running.
   *
   * @returns True if running / 実行中の場合true
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /** Runs one check cycle; the batch itself already swallows DB errors. */
  private async runOnce(): Promise<void> {
    // Filings settle on a different clock from executions: their PR merges well
    // after the task ends, so a decision left pending at task outcome has to be
    // asked about again. Swept here rather than on a scheduler of its own —
    // several settlement points and a disagreement between them leaves no way
    // to tell which verdict was the real one.
    try {
      const { settleFilingDecisions } = await import('../decision-ledger/settle-filing');
      const filings = await settleFilingDecisions();
      if (filings.settled > 0) {
        logger.info(`[DecisionTraceConsistencyScheduler] Filing sweep settled ${filings.settled}`);
      }
    } catch (err) {
      logger.warn({ err }, '[DecisionTraceConsistencyScheduler] Filing sweep failed (non-fatal)');
    }

    const { checked, updated } = await runConsistencyCheckBatch();
    if (checked > 0) {
      logger.info(
        `[DecisionTraceConsistencyScheduler] Batch completed: ${checked} checked, ${updated} updated`,
      );
    } else {
      logger.debug('[DecisionTraceConsistencyScheduler] Batch completed: no pending traces');
    }
  }
}

// Singleton instance for global use
let globalScheduler: DecisionTraceConsistencyScheduler | null = null;

/**
 * Get the global decision-trace consistency scheduler instance.
 *
 * @returns Global scheduler instance / グローバルスケジューラインスタンス
 */
export function getDecisionTraceConsistencyScheduler(): DecisionTraceConsistencyScheduler {
  if (!globalScheduler) {
    globalScheduler = new DecisionTraceConsistencyScheduler();
  }
  return globalScheduler;
}

/**
 * Start the global decision-trace consistency scheduler.
 *
 * @param intervalMs - Optional check interval in milliseconds / オプションのチェック間隔（ミリ秒）
 */
export function startDecisionTraceConsistencyScheduler(intervalMs?: number): void {
  getDecisionTraceConsistencyScheduler().start(intervalMs);
}

/**
 * Stop the global decision-trace consistency scheduler.
 */
export function stopDecisionTraceConsistencyScheduler(): void {
  getDecisionTraceConsistencyScheduler().stop();
}
