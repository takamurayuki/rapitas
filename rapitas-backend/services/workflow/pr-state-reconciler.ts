/**
 * pr-state-reconciler
 *
 * Reconciles the local `GitHubPullRequest.state` of rows we still believe are
 * open against what GitHub actually reports, and writes the closure back.
 * Responsible ONLY for that state read-back: it never closes, merges, or
 * reopens anything on GitHub, and it never touches a Task.
 *
 * Why this exists: a PR closed OUTSIDE this app — by the stale-bot workflow, by
 * a human, or by GitHub itself when a base branch goes away — is never reflected
 * locally. `stale-pr-reaper` syncs only the closures it performs itself, and the
 * webhook path only helps while webhook delivery is actually working. Measured
 * 2026-09-28: 19 tasks (885-964) still carried `state: 'open'` rows for PRs
 * (#690, #692, #699, #700, #713, …) that GitHub had reported CLOSED for weeks.
 *
 * What that stale state costs, all of it read off the same rows:
 *  - `auto-merge-candidates` re-admits those 19 dead tasks every tick, and
 *    `canContinueAutoMerge` rejects each with a WARN — 152 of 161 log lines in
 *    one 7m34s window, roughly 29,000 lines a day.
 *  - `open-pr-files-cache` feeds the overlap guard from these rows, so a
 *    long-gone PR can hold an implementer. Only the guard's 6-hour freshness
 *    window keeps these particular rows harmless — luck, not design.
 *  - `duplicate_open_prs` can fire for a task whose "other" PR is closed.
 */
import { existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrismaClient } from '../../generated/prisma-postgres';
import { createLogger } from '../../config/logger';
import { ghPath } from './auto-merge-checks';

const execAsync = promisify(exec);
const log = createLogger('workflow:pr-state-reconciler');

/**
 * Re-ask GitHub about one locally-open row at most this often. `lastSyncedAt` is
 * stamped on every check — including one that confirms the PR is still open — so
 * a genuinely open PR costs one `gh` call per window, not one per tick.
 */
export const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Rows to re-ask GitHub about per pass. With 19 stale rows this converges in four passes. */
export const MAX_CHECKS_PER_TICK = 5;

/** Injectable side effects for unit tests. */
export interface PrStateReconcilerDeps {
  /** Run `gh <args>` in cwd and return stdout. */
  execGh: (command: string, cwd: string) => Promise<string>;
  /** Whether a directory exists (so tests need no real filesystem). */
  dirExists: (dir: string) => boolean;
  /** Clock (epoch ms). */
  now: () => number;
}

const defaultDeps: PrStateReconcilerDeps = {
  execGh: async (command, cwd) => {
    const { stdout } = await execAsync(command, { cwd, encoding: 'utf8', timeout: 15_000 });
    return stdout;
  },
  dirExists: existsSync,
  now: () => Date.now(),
};

/** Outcome of one reconciliation pass. */
export interface ReconcileResult {
  /** PR numbers whose local row was moved off 'open'. / ローカル状態を open から変えたPR番号 */
  syncedPrNumbers: number[];
  /** Rows re-asked about this pass, whatever the answer. / 今回問い合わせた件数 */
  checked: number;
}

/** Local state to write for a GitHub state, or null when nothing should change. */
function localStateFor(
  ghState: string | undefined,
  mergedAt: string | null | undefined,
): string | null {
  const state = (ghState ?? '').toUpperCase();
  if (state === 'MERGED' || mergedAt) return 'merged';
  if (state === 'CLOSED') return 'closed';
  return null;
}

/**
 * Re-ask GitHub about the locally-open PR rows we have not checked recently, and
 * write back any that GitHub reports closed or merged.
 *
 * Fail-open throughout: an unreadable row, a missing working directory, or a
 * failed `gh` call skips that row WITHOUT stamping `lastSyncedAt`, so the next
 * pass retries it. Only an answer we actually received is recorded.
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param deps - Injectable exec/clock/fs (tests). / テスト用注入
 * @returns Which rows were synced and how many were checked. / 同期結果
 */
export async function reconcilePrStates(
  prisma: PrismaClient,
  deps: Partial<PrStateReconcilerDeps> = {},
): Promise<ReconcileResult> {
  const { execGh, dirExists, now } = { ...defaultDeps, ...deps };
  const syncedPrNumbers: number[] = [];
  let checked = 0;

  const rows = await prisma.gitHubPullRequest
    .findMany({
      where: { state: 'open', lastSyncedAt: { lt: new Date(now() - RECHECK_INTERVAL_MS) } },
      orderBy: { lastSyncedAt: 'asc' },
      take: MAX_CHECKS_PER_TICK,
      select: { id: true, prNumber: true, linkedTaskId: true },
    })
    .catch((err) => {
      log.warn({ err }, '[pr-state-reconciler] row lookup failed — skipping this pass');
      return [] as { id: number; prNumber: number; linkedTaskId: number | null }[];
    });

  for (const row of rows) {
    const cwd = await resolveCwd(prisma, row.linkedTaskId, dirExists);
    if (!cwd) continue;

    let parsed: { state?: string; mergedAt?: string | null };
    try {
      const stdout = await execGh(`${ghPath()} pr view ${row.prNumber} --json state,mergedAt`, cwd);
      parsed = JSON.parse(stdout) as { state?: string; mergedAt?: string | null };
    } catch (err) {
      // A transient gh/network failure must not be recorded as "still open":
      // leaving lastSyncedAt alone is what makes the next pass retry this row.
      log.warn(
        { err, prNumber: row.prNumber },
        '[pr-state-reconciler] state read failed — leaving the row for the next pass',
      );
      continue;
    }
    checked++;

    const nextState = localStateFor(parsed.state, parsed.mergedAt);
    const data = nextState
      ? { state: nextState, lastSyncedAt: new Date(now()) }
      : { lastSyncedAt: new Date(now()) };
    const written = await prisma.gitHubPullRequest
      .update({ where: { id: row.id }, data })
      .then(() => true)
      .catch((err) => {
        log.warn({ err, prNumber: row.prNumber }, '[pr-state-reconciler] state write failed');
        return false;
      });
    if (written && nextState) {
      syncedPrNumbers.push(row.prNumber);
      log.info(
        { prNumber: row.prNumber, taskId: row.linkedTaskId, state: nextState },
        '[pr-state-reconciler] PR is no longer open on GitHub — local state synced',
      );
    }
  }

  return { syncedPrNumbers, checked };
}

/**
 * A directory `gh` can run in for this PR's repo.
 *
 * `gh pr view` is a GitHub API call and needs only a clone that names the right
 * remote, so the task's own worktree (often already cleaned up for a done task)
 * is merely the first preference — same resolution order the auto-merge
 * candidates use.
 */
async function resolveCwd(
  prisma: PrismaClient,
  taskId: number | null,
  dirExists: (dir: string) => boolean,
): Promise<string | null> {
  if (taskId == null) return null;
  const task = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: { workingDirectory: true, theme: { select: { workingDirectory: true } } },
    })
    .catch(() => null);
  if (!task) return null;
  return (
    [task.workingDirectory, task.theme?.workingDirectory].find(
      (d): d is string => !!d && dirExists(d),
    ) ?? null
  );
}
