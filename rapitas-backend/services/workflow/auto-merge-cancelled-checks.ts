/**
 * auto-merge-cancelled-checks
 *
 * Handles the case where a BLOCKING auto-merge check is `cancelled` rather than
 * genuinely failed: re-runs the workflow (bounded per head SHA) instead of
 * bouncing the task to ci_repair. NOT responsible for real CI failures — those
 * stay with auto-merge-ci-failure — nor for deciding the aggregate check state
 * (auto-merge-checks owns that).
 *
 * Why this exists: evaluateAutoMergeChecks folds bucket 'cancel' into 'fail',
 * so a cancelled run sent the implementer after a diff that was never broken.
 * Observed on task 1145 (2026-10-07): the ubuntu build hung, the run was
 * cancelled, and the task bounced ci_repair attempt=1 with
 * cat=CI:Build (ubuntu-latest). A cancellation says nothing about the code — it
 * is a superseded push, a manual stop, or a timeout-minutes kill — and
 * ci_repair has nothing to fix, so it burns an implementer run and converges on
 * `ci_repair_no_diff`. Re-running is the response that can actually clear it.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
import { ghPath, readHeadSha } from './auto-merge-checks';
import type { PrCheck } from './auto-merge-checks';
import type { Candidate } from './auto-merge-candidates';

const execAsync = promisify(exec);
const log = createLogger('workflow:auto-merge-cancelled-checks');

/** WorkflowTransition.cause recording one rerun of cancelled checks. */
export const CANCELLED_RERUN_CAUSE = 'auto_merge_cancelled_rerun';

/**
 * Reruns allowed per head SHA before falling through to the normal failure
 * path. Two is enough to clear a one-off infrastructure cancellation; a third
 * identical cancellation is a signal worth surfacing, not retrying forever.
 */
export const MAX_CANCELLED_RERUNS = 2;

/**
 * Split a PR's blocking checks into the genuinely failed and the merely cancelled.
 *
 * @param checks - All checks reported for the PR. / PRの全チェック
 * @param blocking - Names that gate the merge. / マージをゲートするチェック名
 * @returns The red blocking checks, partitioned by cause. / 原因別に分けた赤チェック
 */
export function splitRedChecks(
  checks: PrCheck[],
  blocking: Set<string>,
): { failed: PrCheck[]; cancelled: PrCheck[] } {
  const red = checks.filter(
    (c) => blocking.has(c.name) && (c.bucket === 'fail' || c.bucket === 'cancel'),
  );
  return {
    failed: red.filter((c) => c.bucket === 'fail'),
    cancelled: red.filter((c) => c.bucket === 'cancel'),
  };
}

/**
 * Distinct GitHub Actions run ids behind the given checks' details URLs.
 *
 * Several cancelled checks usually belong to ONE run (a matrix job), and
 * `gh run rerun` works per run, so the ids are de-duplicated. Links that are
 * not Actions run URLs (external CI apps) carry nothing we can rerun.
 *
 * @param checks - Checks whose details URLs should be mined. / 対象チェック
 * @returns Run ids in first-seen order. / 重複排除した run id
 */
export function rerunRunIdsFromChecks(checks: PrCheck[]): string[] {
  const ids: string[] = [];
  for (const c of checks) {
    const runId = c.link?.match(/\/actions\/runs\/(\d+)/)?.[1];
    if (runId && !ids.includes(runId)) ids.push(runId);
  }
  return ids;
}

/**
 * How many reruns have already been recorded for this head SHA.
 * FAIL OPEN on a DB error (reads as zero): like the update-branch attempt
 * counter this bounds a cheap, idempotent gh call, not a spend budget.
 */
async function rerunsSpentFor(taskId: number, headSha: string): Promise<number> {
  const rows = await prisma.workflowTransition
    .findMany({
      where: { taskId, cause: CANCELLED_RERUN_CAUSE },
      select: { metadata: true },
    })
    .catch(() => []);
  return rows.filter((r) => {
    if (!r.metadata) return false;
    try {
      const parsed = JSON.parse(r.metadata) as { headSha?: unknown };
      return parsed.headSha === headSha;
    } catch {
      return false;
    }
  }).length;
}

/**
 * Re-run the workflows behind cancelled blocking checks instead of bouncing.
 *
 * Returns false — meaning "not handled, continue with the normal failure
 * path" — when there is nothing rerunnable, when the per-head-SHA budget is
 * spent, or when gh refuses every rerun. Claiming to have handled a candidate
 * that was not actually re-run would park it silently forever.
 *
 * @param c - The auto-merge candidate whose checks were cancelled. / 対象候補
 * @param cancelled - The cancelled blocking checks. / キャンセルされたチェック
 * @returns true when a rerun was dispatched and the next tick should
 *   re-evaluate. / 再実行を投げたか
 */
export async function handleCancelledChecks(c: Candidate, cancelled: PrCheck[]): Promise<boolean> {
  const runIds = rerunRunIdsFromChecks(cancelled);
  if (runIds.length === 0) return false;

  const headSha = (await readHeadSha(c.cwd, c.prNumber)) ?? 'unknown';
  const spent = await rerunsSpentFor(c.taskId, headSha);
  if (spent >= MAX_CANCELLED_RERUNS) {
    log.info(
      { taskId: c.taskId, prNumber: c.prNumber, headSha, spent },
      '[auto-merge] Cancelled checks persisted past the rerun budget — falling through to the failure path',
    );
    return false;
  }

  const rerun: string[] = [];
  for (const runId of runIds) {
    try {
      // --failed re-runs only the cancelled/failed jobs, so a passing matrix
      // leg is not paid for twice.
      await execAsync(`${ghPath()} run rerun ${runId} --failed`, { cwd: c.cwd, encoding: 'utf8' });
      rerun.push(runId);
    } catch (err) {
      log.warn({ err, taskId: c.taskId, runId }, '[auto-merge] Failed to rerun a cancelled run');
    }
  }
  if (rerun.length === 0) return false;

  await recordTransition({
    taskId: c.taskId,
    fromStatus: 'completed',
    toStatus: 'completed',
    actor: 'system',
    cause: CANCELLED_RERUN_CAUSE,
    phase: 'verify',
    metadata: {
      headSha,
      prNumber: c.prNumber,
      attempt: spent + 1,
      runIds: rerun,
      cancelledChecks: cancelled.map((ch) => ch.name),
    },
  });
  log.info(
    { taskId: c.taskId, prNumber: c.prNumber, headSha, runIds: rerun, attempt: spent + 1 },
    '[auto-merge] Blocking checks were cancelled, not failed — re-ran the workflow instead of bouncing ci_repair',
  );
  return true;
}
