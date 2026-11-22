/**
 * auto-merge-pending-timeout
 *
 * Decides what the auto-merge watcher does when a candidate's CI has been
 * pending past the timeout: report a CI timeout, or — when GitHub says the PR is
 * no longer open — sync the local row instead. It does not read checks or merge.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { readPrState } from './auto-merge-checks';
import { resolveIntegrationId } from '../github/pr-link';
import { notify as defaultNotify } from './auto-merge-notify';
import type { Candidate } from './auto-merge-candidates';

const log = createLogger('workflow:auto-merge-pending-timeout');

/** How long CI may stay pending before the watcher reports a timeout. */
export const PENDING_TIMEOUT_MS = 90 * 60 * 1000;

/** Outcome of one pending-timeout decision. */
export type PendingTimeoutOutcome = 'waiting' | 'settled' | 'timed_out';

/** Injectable side effects (tests). */
export interface PendingTimeoutDeps {
  /** Clock (epoch ms). */
  now: () => number;
  /** The PR's lifecycle state on GitHub ('open' | 'closed' | 'merged'), or null when unreadable. */
  readPrState: (cwd: string, prNumber: number) => Promise<string | null>;
  /** Move the task's local PR row off 'open'; `cwd` scopes the row to its repo. */
  syncLocalState: (
    taskId: number,
    prNumber: number,
    state: 'merged' | 'closed',
    cwd: string,
  ) => Promise<void>;
  /** Record a terminal auto-merge outcome (the watcher's `mark`). */
  mark: (taskId: number, cause: string, reason: string) => Promise<void>;
  /** Send a notification. */
  notify: typeof defaultNotify;
}

async function syncLocalStateInDb(
  taskId: number,
  prNumber: number,
  state: 'merged' | 'closed',
  cwd: string,
): Promise<void> {
  // prNumber is unique only within a repo, so the row is scoped by integration.
  const integrationId = await resolveIntegrationId(prisma, null, cwd).catch(() => null);
  if (integrationId == null) {
    log.warn({ taskId, prNumber, cwd }, '[auto-merge] integration unresolved — local PR row left');
    return;
  }
  await prisma.gitHubPullRequest
    .updateMany({
      where: { integrationId, linkedTaskId: taskId, prNumber, state: 'open' },
      data: { state, lastSyncedAt: new Date() },
    })
    .catch((err) => log.warn({ err, taskId, prNumber }, '[auto-merge] local PR state sync failed'));
}

/**
 * Handle a candidate whose CI is still pending: wait inside the window, and past
 * it ask GitHub whether the PR is still open before reporting a CI timeout.
 *
 * NOTE: A PR merged or closed outside this app keeps its local row 'open' until
 * pr-state-reconciler re-asks GitHub, which it does at most every 6 h. Trendline
 * task 1528's PR #26 was merged by hand and the watcher recorded "ci timeout"
 * with a timeout notification on three ticks (2026-11-22). A merged row is then
 * completed by recoverMergedTasks on the next tick; GitHub stays the authority.
 *
 * @param c - The auto-merge candidate. / 自動マージ候補
 * @param deps - Clock, GitHub read, local sync, mark and notify. / 依存
 * @returns What happened. / 判定結果
 */
export async function handlePendingTimeout(
  c: Candidate,
  deps: Partial<PendingTimeoutDeps> & Pick<PendingTimeoutDeps, 'mark'>,
): Promise<PendingTimeoutOutcome> {
  const d: PendingTimeoutDeps = {
    now: Date.now,
    readPrState,
    syncLocalState: syncLocalStateInDb,
    notify: defaultNotify,
    ...deps,
  };
  const since = (c.waitSince ?? c.completedAt)?.getTime() ?? d.now();
  if (d.now() - since <= PENDING_TIMEOUT_MS) return 'waiting';

  const ghState = await d.readPrState(c.cwd, c.prNumber);
  if (ghState === 'merged' || ghState === 'closed') {
    await d.syncLocalState(c.taskId, c.prNumber, ghState, c.cwd);
    log.info(
      { taskId: c.taskId, prNumber: c.prNumber, state: ghState },
      '[auto-merge] PR is no longer open on GitHub — synced instead of reporting a CI timeout',
    );
    return 'settled';
  }

  await d.mark(c.taskId, 'auto_merge_blocked', 'ci timeout');
  await d.notify({
    taskId: c.taskId,
    type: 'auto_merge_timeout',
    title: '自動マージ保留（CIタイムアウト）',
    message: `PR #${c.prNumber} のCIが時間内に完了しなかったため自動マージを保留しました。`,
  });
  return 'timed_out';
}
