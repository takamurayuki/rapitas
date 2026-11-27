/**
 * AutoRestartMergedCodeScheduler
 *
 * Detects commits merged to origin/<primary branch> that this process is not
 * running yet (merged-but-inactive code) and, when the system is idle and the
 * autoRestartOnMergedCode toggle is on, fast-forwards the checkout and
 * triggers the shared shutdown sequence (exit 75 → dev.js relaunch).
 * Deliberately independent from dev-restart-on-dry (different comparison base
 * and trigger); not responsible for selecting or creating tasks.
 */
import { createLogger } from '../../../config/logger';
import { logCycleEvent } from '../../observability/cycle-event-logger';
import { createNotification } from '../../communication/notification-service';
import { scheduleShutdownSequence } from '../../system/shutdown-sequence';
import { getAgentSystemSnapshot } from '../../../routes/agents/system/agent-system-router';
import { countLiveTrackedProcesses } from '../../agents/agent-process-tracker';
import { AutoMergeWatcher } from '../../workflow/auto-merge-watcher';
import { decideAutoRestart } from './decision';
import { hasRestartSupervisor, RESTART_SUPERVISOR_ENV } from './restart-supervisor';
import {
  classifyMergeUrgency,
  decideBoundaryRestart,
  isSnapshotBusy,
  restartQueueDepth,
  resolveIdleBoundaryPolls,
  resolveIntervalMs,
  resolvePollerMinRestartIntervalMs,
  resolveRestartMinIntervalMs,
  resolveRestartUiQuietMs,
  resolveRestartMaxDeferrals,
} from './boundary-policy';
import {
  captureStartupCommit,
  fetchAndCountAhead,
  isWorkingTreeClean,
  fastForwardToRemote,
  listChangedPaths,
} from './git-io';
import {
  readAutoRestartEnabled,
  readLatestAutoRestartAt,
  writeLastRestartAt,
  readDeferCount,
  writeDeferCount,
} from './settings-store';
import { getLastUiRequestAt } from './ui-activity-tracker';
import { dependencyGate } from './dependency-preflight';
import { tickRestartWait } from './restart-wait';

const logger = createLogger('auto-restart-merged-code-scheduler');

export class AutoRestartMergedCodeScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private startupCommit: string | null = null;

  /**
   * Start the periodic merged-code check. No-op outside the dev orchestrator
   * (dev.js relaunches on exit 75; nothing else does, so exiting elsewhere
   * would orphan the backend — same guard as dev-restart-on-dry).
   *
   * @param intervalMs - Check interval in milliseconds (defaults to env / 15 min) / チェック間隔（ミリ秒）
   */
  async start(intervalMs?: number): Promise<void> {
    if (this.isRunning) {
      logger.warn('[AutoRestartMergedCode] Already running, ignoring start request');
      return;
    }
    // NOTE: warn, not debug — the log file keeps level 40+, so this refusal was
    // invisible and hours of it read as silence (#1132).
    if (!hasRestartSupervisor()) {
      logger.warn(
        `[AutoRestartMergedCode] Self-deploy scheduler not started: nothing is known to relaunch this process after exit 75 (TAURI_BUILD and ${RESTART_SUPERVISOR_ENV} are unset). Merged code will not be activated automatically; set ${RESTART_SUPERVISOR_ENV}=true if this run is supervised.`,
      );
      return;
    }

    this.startupCommit = await captureStartupCommit();
    if (!this.startupCommit) {
      logger.warn('[AutoRestartMergedCode] Could not capture startup commit — scheduler disabled');
      return;
    }

    const interval = intervalMs ?? resolveIntervalMs();
    logger.info(
      { startupCommit: this.startupCommit, intervalMs: interval },
      '[AutoRestartMergedCode] Starting scheduler',
    );
    this.isRunning = true;

    // First check immediately so a restart that already lags origin doesn't
    // wait a full interval to notice.
    this.runOnce().catch((error) => {
      logger.error({ err: error }, '[AutoRestartMergedCode] Initial check failed');
    });

    this.intervalId = setInterval(() => {
      this.runOnce().catch((error) => {
        logger.error({ err: error }, '[AutoRestartMergedCode] Scheduled check failed');
      });
    }, interval);
  }

  /**
   * Stop the periodic merged-code check.
   */
  stop(): void {
    if (!this.isRunning) {
      logger.debug('[AutoRestartMergedCode] Not running, ignoring stop request');
      return;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('[AutoRestartMergedCode] Stopped');
  }

  /**
   * Check if the scheduler is currently running.
   *
   * @returns True if running / 実行中の場合true
   */
  /**
   * The last reason a boundary restart was declined.
   *
   * Kept so the warning is written once per reason rather than once per
   * poll: the point is that a stuck self-deploy is visible, not that the log
   * fills up with the same line every fifteen minutes.
   */
  private lastBoundaryWaitReason: string | null = null;

  /**
   * Consecutive polls that found a batched merge waiting on an idle system.
   *
   * Reset the moment anything is running, so it only ever counts genuine
   * quiet. See `considerIdleBoundary`.
   */
  private idlePollsWithBatchedMerge = 0;

  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * The commit this process started on, which `deploy-now` compares against.
   *
   * Null outside the dev orchestrator, since `start()` is a no-op there and
   * never captures one — which is exactly what makes it a usable guard.
   *
   * @returns The startup commit, or null / 起動時のコミット（無ければ null）
   */
  getStartupCommit(): string | null {
    return this.startupCommit;
  }

  /**
   * Decide what to do about a merge that classification sent to the boundary.
   *
   * Batching exists so restarts do not churn in the middle of work, and the
   * boundary it waits for is an auto-run task completing. On a system with
   * auto-run stopped that boundary never arrives: measured 2026-10-20, four
   * merges sat unactivated for a day while the poller declined silently every
   * tick. The quieter the system, the less likely merged code was ever to
   * run — the opposite of what the gates intend, since idle is the safest
   * moment there is to restart.
   *
   * So sustained idle becomes a boundary in its own right. The decision
   * itself is still `evaluateBoundaryRestart`'s: this only decides when to
   * ask it, and asking does not relax a single one of its gates.
   *
   * @param aheadCount - Commits waiting to be activated / 未反映コミット数
   * @param changedFiles - How many files that merge touched / 変更ファイル数
   * @returns True when a restart was triggered / 再起動を発火したか
   */
  private async considerIdleBoundary(aheadCount: number, changedFiles: number): Promise<boolean> {
    const snapshot = await getAgentSystemSnapshot();
    const busy =
      snapshot.isShuttingDown ||
      snapshot.activeExecutions > 0 ||
      snapshot.runningExecutions > 0 ||
      restartQueueDepth(snapshot) > 0;
    if (busy) {
      this.idlePollsWithBatchedMerge = 0;
      return false;
    }

    this.idlePollsWithBatchedMerge += 1;
    const needed = resolveIdleBoundaryPolls();
    if (this.idlePollsWithBatchedMerge < needed) {
      // Cycle log, once per batch: a silent decline hid this for a day. Waiting is the design.
      if (this.idlePollsWithBatchedMerge === 1) {
        logCycleEvent('restart.waiting', { cause: 'task_boundary', aheadCount, changedFiles });
        logger.info(
          { aheadCount, changedFiles, needed },
          '[AutoRestartMergedCode] merged code is waiting for a task boundary; it will activate if the system stays idle',
        );
      }
      return false;
    }

    logger.info(
      { aheadCount, idlePolls: this.idlePollsWithBatchedMerge },
      '[AutoRestartMergedCode] system idle with merged code waiting — treating the idle as the boundary',
    );
    this.idlePollsWithBatchedMerge = 0;
    return this.evaluateBoundaryRestart();
  }

  // Feeds the restart wait (restart-wait.ts); one call shape for both entry points.
  private noteAhead(aheadCount: number, changedPaths: readonly string[]): Promise<void> {
    return tickRestartWait({
      aheadCount,
      changedPaths,
      lastRestartAt: readLatestAutoRestartAt(),
      evaluate: () => this.evaluateBoundaryRestart(),
    });
  }

  /**
   * One detection/decision/execution cycle. Public so tests can drive it
   * directly; the interval calls it on schedule.
   *
   * @returns True when a restart was triggered this cycle / 今回のサイクルで再起動を発火したか
   */
  async runOnce(): Promise<boolean> {
    // Cheapest gate first: skip all git I/O while the toggle is off.
    const settingEnabled = readAutoRestartEnabled();
    if (!settingEnabled) return false;
    if (!this.startupCommit) return false;

    const branch = process.env.RAPITAS_PRIMARY_BRANCH || 'develop';
    const aheadCount = await fetchAndCountAhead(this.startupCommit, branch);
    if (aheadCount === null) return false;
    if (aheadCount <= 0) return this.noteAhead(0, []).then(() => false);

    // Restart-timing governance: only merges touching the loop machinery
    // itself may restart from this poller. Everything else (UI-only, feature
    // work) is batched until the next task boundary (evaluateBoundaryRestart),
    // so per-merge restart churn — and each restart's aux-CLI orphaning
    // exposure — is bounded by task boundaries, not merge frequency.
    const changedPaths = await listChangedPaths(this.startupCommit, branch);
    await this.noteAhead(aheadCount, changedPaths);
    if (classifyMergeUrgency(changedPaths) !== 'immediate') {
      logger.debug(
        { aheadCount, changedFiles: changedPaths.length },
        '[AutoRestartMergedCode] Non-machinery merge — batched until next task boundary',
      );
      return this.considerIdleBoundary(aheadCount, changedPaths.length);
    }

    // A machinery merge fires now, so nothing is left waiting on idle.
    this.idlePollsWithBatchedMerge = 0;

    const snapshot = await getAgentSystemSnapshot();
    if (snapshot.activeExecutionsDegraded) return false;
    // NOTE: Both stamps — a dev-restart-on-dry restart also holds this path (task 1548).
    const lastRestartAt = readLatestAutoRestartAt();
    const decision = decideAutoRestart({
      aheadCount,
      activeExecutions: snapshot.activeExecutions,
      runningExecutions: snapshot.runningExecutions,
      queueDepth: restartQueueDepth(snapshot),
      isShuttingDown: snapshot.isShuttingDown,
      settingEnabled,
      msSinceLastRestart: lastRestartAt === 0 ? null : Date.now() - lastRestartAt,
      minRestartIntervalMs: resolvePollerMinRestartIntervalMs(),
    });
    if (!decision.shouldRestart) {
      logger.debug({ reason: decision.reason, aheadCount }, '[AutoRestartMergedCode] gated');
      return false;
    }

    // Never pull over uncommitted work (self-dev agents edit the primary checkout).
    if (!(await isWorkingTreeClean())) {
      logger.warn('[AutoRestartMergedCode] Working tree dirty — skipping pull/restart this tick');
      return false;
    }
    // #1403: a lockfile dev.js could not reinstall would strand the restart.
    if (await dependencyGate(changedPaths)) return false;

    // Without this pull, exit(75) relaunches on the SAME old commit: dev.js's
    // ensurePrimaryBranch never pulls, and PR merge skips primary-checkout sync.
    if (!(await fastForwardToRemote(branch))) {
      return false;
    }

    // Re-confirm idleness right before firing: an execution may have started
    // during fetch/pull. aheadCount stays non-zero next tick (startup-commit
    // base), so a skipped restart is retried, not lost.
    const recheck = await getAgentSystemSnapshot();
    if (isSnapshotBusy(recheck)) {
      logger.info(
        {
          isShuttingDown: recheck.isShuttingDown,
          activeExecutions: recheck.activeExecutions,
          runningExecutions: recheck.runningExecutions,
          queueDepth: restartQueueDepth(recheck),
        },
        '[AutoRestartMergedCode] Busy at final recheck — restart deferred to next tick',
      );
      return false;
    }

    await createNotification({
      type: 'system',
      title: '自動再起動',
      message: `未活性コミット${aheadCount}件を活性化するため再起動します`,
    }).catch((err) => {
      logger.warn({ err }, '[AutoRestartMergedCode] Notification failed — restarting anyway');
    });
    writeLastRestartAt(Date.now());
    // NOTE(#1565): info, not warn — this is the planned activation of merged
    // code at a quiet point, and the person is already told by the notification.
    logger.info(
      { aheadCount, branch, startupCommit: this.startupCommit },
      '[AutoRestartMergedCode] Restarting to activate merged code',
    );
    scheduleShutdownSequence('[auto-restart]', 75);
    return true;
  }

  // Serializes concurrent boundary evaluations (multiple theme ticks can hit
  // a task boundary at once) so two evaluations can never double-fire.
  private boundaryEvaluationInFlight = false;

  /**
   * Task-boundary restart evaluation. Called by the auto-run scheduler AFTER
   * a task finished and BEFORE the next one is selected (a natural 0-agent
   * quiescence point), and only after dev-restart-on-dry declined (the caller
   * returns on its true, so the two paths never double-fire in one tick).
   *
   * Activates ANY pending merge (machinery or batched) once every quiescence
   * gate passes: no executions, no queued work, no live aux CLI children, no
   * merge mid-processing, rate limit satisfied, and the UI quiet — a UI-active
   * boundary defers (bounded by RAPITAS_RESTART_MAX_DEFERRALS, then forced).
   * Reads the latest stamp of every automatic path (poller, deploy-now,
   * dev-restart-on-dry) so they share one floor, but uses its own interval env.
   *
   * @returns True when a restart was triggered (caller must stop its tick) / 再起動を発火したか
   */
  async evaluateBoundaryRestart(): Promise<boolean> {
    if (this.boundaryEvaluationInFlight) return false;
    this.boundaryEvaluationInFlight = true;
    try {
      // Same cheap gates as the poller: toggle first (no git I/O while off),
      // and startupCommit doubles as the "scheduler actually started under
      // the dev orchestrator" guard (start() is a no-op outside TAURI_BUILD).
      if (!readAutoRestartEnabled()) return false;
      if (!this.startupCommit) return false;

      const branch = process.env.RAPITAS_PRIMARY_BRANCH || 'develop';
      const aheadCount = await fetchAndCountAhead(this.startupCommit, branch);
      if (aheadCount === null) return false;
      if (aheadCount <= 0) {
        await this.noteAhead(0, []);
        return false;
      }

      const snapshot = await getAgentSystemSnapshot();
      if (snapshot.activeExecutionsDegraded) return false;
      const lastRestartAt = readLatestAutoRestartAt();
      const lastUiAt = getLastUiRequestAt();
      const deferCount = readDeferCount();
      const now = Date.now();
      const decision = decideBoundaryRestart({
        aheadCount,
        isShuttingDown: snapshot.isShuttingDown,
        activeExecutions: snapshot.activeExecutions,
        runningExecutions: snapshot.runningExecutions,
        queueDepth: restartQueueDepth(snapshot),
        auxChildren: countLiveTrackedProcesses('cli-agent'),
        isMerging: AutoMergeWatcher.getInstance().isMerging(),
        msSinceLastRestart: lastRestartAt === 0 ? null : now - lastRestartAt,
        minRestartIntervalMs: resolveRestartMinIntervalMs(),
        msSinceLastUiActivity: lastUiAt === 0 ? null : now - lastUiAt,
        uiQuietMs: resolveRestartUiQuietMs(),
        deferCount,
        maxDeferrals: resolveRestartMaxDeferrals(),
      });

      if (decision.action === 'wait') {
        // Warn, not debug. Measured 2026-10-20: the idle escalation fired
        // four times, pulled, and then declined here every single time while
        // the log said nothing — the gate that was holding it could only be
        // guessed at from the outside. A system-busy wait does not raise the
        // deferral count either, so this can go on indefinitely; if it does,
        // the reason has to be readable.
        if (this.lastBoundaryWaitReason !== decision.reason) {
          this.lastBoundaryWaitReason = decision.reason;
          logCycleEvent('restart.waiting', { cause: decision.reason, aheadCount, deferCount });
          logger.info(
            {
              reason: decision.reason,
              aheadCount,
              auxChildren: countLiveTrackedProcesses('cli-agent'),
              deferCount,
              msSinceLastUiActivity: lastUiAt === 0 ? null : now - lastUiAt,
            },
            '[AutoRestartMergedCode] merged code is pulled but not activated — a gate is holding the restart',
          );
        } else {
          logger.debug(
            { reason: decision.reason, aheadCount },
            '[AutoRestartMergedCode] Boundary restart gated — retrying at a later boundary',
          );
        }
        return false;
      }
      if (decision.action === 'defer') {
        writeDeferCount(decision.nextDeferCount);
        logger.info(
          { deferCount: decision.nextDeferCount, aheadCount },
          '[AutoRestartMergedCode] UI active at task boundary — restart deferred',
        );
        return false;
      }

      // restart: clean-tree check → ff → notify → stamps → shutdown (exit 75).
      if (!(await isWorkingTreeClean())) {
        logger.warn('[AutoRestartMergedCode] Working tree dirty at boundary — restart skipped');
        return false;
      }
      if (await dependencyGate(await listChangedPaths(this.startupCommit, branch))) return false;
      if (!(await fastForwardToRemote(branch))) {
        return false;
      }
      const recheck = await getAgentSystemSnapshot();
      if (
        isSnapshotBusy(recheck) ||
        countLiveTrackedProcesses('cli-agent') > 0 ||
        AutoMergeWatcher.getInstance().isMerging()
      )
        return false;
      await createNotification({
        type: 'system',
        title: '自動再起動',
        message: `タスク境界で未活性コミット${aheadCount}件を活性化するため再起動します`,
      }).catch((err) => {
        logger.warn({ err }, '[AutoRestartMergedCode] Notification failed — restarting anyway');
      });
      writeLastRestartAt(Date.now());
      writeDeferCount(0);
      logger.warn(
        { aheadCount, branch, reason: decision.reason, startupCommit: this.startupCommit },
        '[AutoRestartMergedCode] Task-boundary restart to activate merged code',
      );
      scheduleShutdownSequence('[auto-restart-boundary]', 75);
      return true;
    } finally {
      this.boundaryEvaluationInFlight = false;
    }
  }
}

// Singleton instance for global use
let globalScheduler: AutoRestartMergedCodeScheduler | null = null;

/**
 * Get the global auto-restart-merged-code scheduler instance.
 *
 * @returns Global scheduler instance / グローバルスケジューラインスタンス
 */
export function getAutoRestartMergedCodeScheduler(): AutoRestartMergedCodeScheduler {
  if (!globalScheduler) {
    globalScheduler = new AutoRestartMergedCodeScheduler();
  }
  return globalScheduler;
}

/**
 * Start the global auto-restart-merged-code scheduler.
 *
 * @param intervalMs - Optional check interval in milliseconds / オプションのチェック間隔（ミリ秒）
 */
export async function startAutoRestartMergedCodeScheduler(intervalMs?: number): Promise<void> {
  await getAutoRestartMergedCodeScheduler().start(intervalMs);
}

/**
 * Stop the global auto-restart-merged-code scheduler.
 */
export function stopAutoRestartMergedCodeScheduler(): void {
  getAutoRestartMergedCodeScheduler().stop();
}

export { decideAutoRestart } from './decision';
export type { AutoRestartDecisionInput, AutoRestartDecision } from './decision';
export { classifyMergeUrgency, decideBoundaryRestart } from './boundary-policy';
export type {
  BoundaryRestartInput,
  BoundaryRestartDecision,
  MergeUrgency,
  BoundaryRestartAction,
} from './boundary-policy';
export { readAutoRestartEnabled, writeAutoRestartEnabled } from './settings-store';
