/**
 * pr-in-flight-wait
 *
 * When two verify epilogues race for the same task — the HTTP verify.md save
 * and the CLI executor's post-run gate — the loser of the PR-creation lock
 * used to be told "no PR" and blocked the task while the winner was still
 * pushing (task 1027, 2026-09-21: blocked at 18:48:41, PR #786 created at
 * 18:48:50, then invisible to the auto-merge watcher because it only scans
 * in-progress tasks). This module lets the loser wait for the winner's PR
 * instead. Not responsible for creating PRs or deciding completion.
 */
import { taskHasLinkedPr } from './workflow-cli-executor-helpers';

/** The exact autoPRResult.error the lock loser receives from workflow-auto-commit. */
export const PR_CREATION_IN_FLIGHT_ERROR = 'PR作成が別プロセスで進行中のためスキップしました';

/** Matches the PR-creation lock's staleness window: the winner cannot hold it longer. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 5_000;

/** Injection points for tests. */
export interface InFlightWaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  hasPr?: (taskId: number) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Poll until the task has a linked PR or the timeout elapses.
 *
 * @param taskId - Task whose PR another process is creating / 対象タスク
 * @param opts - Timeouts and injectable probes / タイムアウトと差し替え可能な探査関数
 * @returns True once a PR is linked; false on timeout / PR が紐付いたら true
 */
export async function waitForInFlightPr(
  taskId: number,
  opts: InFlightWaitOptions = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const hasPr = opts.hasPr ?? taskHasLinkedPr;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const deadline = now() + timeoutMs;
  for (;;) {
    if (await hasPr(taskId).catch(() => false)) return true;
    if (now() >= deadline) return false;
    await sleep(intervalMs);
  }
}
