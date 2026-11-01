/**
 * DeployNow
 *
 * Activating merged code because someone asked, rather than because a poll
 * eventually allowed it.
 *
 * The automatic path (`index.ts`) waits: fifteen minutes a poll, then two
 * consecutive idle polls, then three minutes of UI silence, then ten minutes
 * since the last restart — and a UI-only merge is batched until a task
 * boundary that never arrives on a system with auto-run stopped. Measured
 * 2026-10-20: the checkout had been pulled and the process was still running
 * code from forty-seven minutes earlier. For "I merged a fix, show me", that
 * is the wrong shape of answer.
 *
 * So this drops every gate that is about TIMING and keeps every gate that is
 * about SAFETY. It is not a second implementation of the restart: the git
 * steps and the shutdown are the same ones the scheduler uses.
 *
 * Not responsible for deciding whether code SHOULD ship — CI and the merge
 * did that. This only activates what is already on the primary branch.
 */
import { createLogger } from '../../../config/logger';
import { createNotification } from '../../communication/notification-service';
import { scheduleShutdownSequence } from '../../system/shutdown-sequence';
import { getAgentSystemSnapshot } from '../../../routes/agents/system/agent-system-router';
import { countLiveTrackedProcesses } from '../../agents/agent-process-tracker';
import { AutoMergeWatcher } from '../../workflow/auto-merge-watcher';
import { fetchAndCountAhead, isWorkingTreeClean, fastForwardToRemote } from './git-io';

const logger = createLogger('deploy-now');

/**
 * Why a deploy request ended the way it did.
 *
 * Every refusal names itself. The automatic path's silent declines are how a
 * stuck self-deploy stayed invisible for a day, and a request that comes back
 * "no" without saying which gate held it is the same mistake over HTTP.
 */
export type DeployNowReason =
  /** Pulled, and the process is going down to come back on the new code. */
  | 'deployed'
  /** The scheduler never captured a commit — this is not the dev orchestrator. */
  | 'no-startup-commit'
  /** The remote could not be reached, so "behind" is unknown. */
  | 'ahead-unknown'
  /** Already running the newest commit. */
  | 'nothing-to-activate'
  /** The process is already shutting down. */
  | 'shutting-down'
  /** An execution is active. */
  | 'active-executions'
  /** An agent is mid-run. */
  | 'running-executions'
  /** Work is queued. */
  | 'queue-not-empty'
  /** An auto-merge is in flight. */
  | 'merge-in-flight'
  /** A helper CLI process is still alive and would be orphaned. */
  | 'aux-children'
  /** The snapshot could not be trusted. */
  | 'snapshot-degraded'
  /** Uncommitted work in the checkout; pulling would destroy it. */
  | 'working-tree-dirty'
  /** The checkout has diverged and cannot fast-forward. */
  | 'fast-forward-failed';

export interface DeployNowResult {
  deployed: boolean;
  reason: DeployNowReason;
  /** Commits that were waiting, when that could be determined. */
  aheadCount?: number;
}

/** The safety gates, in the order they are cheapest to answer. */
function findBlocker(
  snapshot: {
    activeExecutions: number;
    runningExecutions: number;
    queueDepth: number;
    isShuttingDown: boolean;
    activeExecutionsDegraded: boolean;
  },
  auxChildren: number,
  merging: boolean,
): DeployNowReason | null {
  if (snapshot.activeExecutionsDegraded) return 'snapshot-degraded';
  if (snapshot.isShuttingDown) return 'shutting-down';
  if (snapshot.activeExecutions > 0) return 'active-executions';
  if (snapshot.runningExecutions > 0) return 'running-executions';
  if (snapshot.queueDepth > 0) return 'queue-not-empty';
  if (merging) return 'merge-in-flight';
  if (auxChildren > 0) return 'aux-children';
  return null;
}

export interface DeployInspection {
  /** True when a request would go through right now. */
  ready: boolean;
  /** What would hold it, or 'deployed' when nothing would. */
  reason: DeployNowReason;
  aheadCount?: number;
}

/**
 * Report what a deploy request would do, without doing any of it.
 *
 * Exists because the request itself restarts the process, so it is not
 * something to press to find out. This answers "is there anything waiting,
 * and would it go" and touches nothing: no fetch of the working tree state,
 * no fast-forward, no shutdown.
 *
 * @param startupCommit - The commit this process started on / 起動時のコミット
 * @returns Whether it would go, and the gate that would hold it / 可否と阻害ゲート
 */
export async function inspectDeploy(startupCommit: string | null): Promise<DeployInspection> {
  if (!startupCommit) return { ready: false, reason: 'no-startup-commit' };

  const branch = process.env.RAPITAS_PRIMARY_BRANCH || 'develop';
  const aheadCount = await fetchAndCountAhead(startupCommit, branch);
  if (aheadCount === null) return { ready: false, reason: 'ahead-unknown' };
  if (aheadCount <= 0) return { ready: false, reason: 'nothing-to-activate', aheadCount: 0 };

  const snapshot = await getAgentSystemSnapshot();
  const blocker = findBlocker(
    snapshot,
    countLiveTrackedProcesses('cli-agent'),
    AutoMergeWatcher.getInstance().isMerging(),
  );
  if (blocker) return { ready: false, reason: blocker, aheadCount };

  // The dirty-tree check is a `git status`, which is cheap and is the gate
  // most likely to surprise someone: a self-dev agent editing the checkout
  // blocks the deploy and nothing else would say so.
  if (!(await isWorkingTreeClean()))
    return { ready: false, reason: 'working-tree-dirty', aheadCount };

  return { ready: true, reason: 'deployed', aheadCount };
}

/**
 * Pull the primary branch and restart, if nothing is in the way.
 *
 * @param startupCommit - The commit this process started on / 起動時のコミット
 * @returns What happened, with the gate named when it refused / 結果（拒否時はゲート名）
 */
export async function deployNow(startupCommit: string | null): Promise<DeployNowResult> {
  if (!startupCommit) return { deployed: false, reason: 'no-startup-commit' };

  const branch = process.env.RAPITAS_PRIMARY_BRANCH || 'develop';
  const aheadCount = await fetchAndCountAhead(startupCommit, branch);
  if (aheadCount === null) return { deployed: false, reason: 'ahead-unknown' };
  if (aheadCount <= 0) return { deployed: false, reason: 'nothing-to-activate', aheadCount: 0 };

  const snapshot = await getAgentSystemSnapshot();
  const blocker = findBlocker(
    snapshot,
    countLiveTrackedProcesses('cli-agent'),
    AutoMergeWatcher.getInstance().isMerging(),
  );
  if (blocker) {
    logger.info({ reason: blocker, aheadCount }, 'deploy request refused');
    return { deployed: false, reason: blocker, aheadCount };
  }

  // Self-dev agents edit the primary checkout; a fast-forward over their
  // uncommitted work would destroy it. Checked before the pull, not after.
  if (!(await isWorkingTreeClean())) {
    logger.warn({ aheadCount }, 'deploy request refused: working tree dirty');
    return { deployed: false, reason: 'working-tree-dirty', aheadCount };
  }

  // Without the pull, exit(75) relaunches on the SAME commit and the deploy
  // looks like it silently did nothing.
  if (!(await fastForwardToRemote(branch))) {
    logger.warn({ aheadCount, branch }, 'deploy request refused: fast-forward failed');
    return { deployed: false, reason: 'fast-forward-failed', aheadCount };
  }

  await createNotification({
    type: 'system',
    title: '手動デプロイ',
    message: `未反映コミット${aheadCount}件を反映するため再起動します`,
  }).catch((err) => {
    logger.warn({ err }, 'notification failed — restarting anyway');
  });

  logger.warn({ aheadCount, branch, startupCommit }, 'deploy requested — restarting to activate');
  scheduleShutdownSequence('[deploy-now]', 75);
  return { deployed: true, reason: 'deployed', aheadCount };
}
