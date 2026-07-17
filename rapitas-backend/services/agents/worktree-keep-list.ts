/**
 * WorktreeKeepList
 *
 * Computes which worktrees under .worktrees/ belong to LIVE (non-terminal)
 * tasks and therefore must survive the "stale worktree" cleanup that runs on
 * every agent-worker (re)initialization. Without this filter the cleanup
 * deleted every worktree unconditionally — wiping the uncommitted work of
 * in-flight tasks whenever a worker respawned (task 494: the implementer's
 * finished changes vanished before verification, which then bounced the task
 * for an "empty" implementation). Main-process only: the worker has no DB
 * access, so the keep list travels to it over IPC.
 */
import { readdir } from 'fs/promises';
import { join } from 'path';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('worktree-keep-list');

/** Directory (under the repo root) that task worktrees live in. */
const WORKTREE_DIR = '.worktrees';

/** Task statuses whose worktrees are safe to delete. */
const TERMINAL_STATUSES = ['completed', 'cancelled'];

/**
 * Extract the owning task id from a worktree directory name
 * (convention: `task-<id>-<hash>`). Exported for unit tests.
 *
 * @param dirName - Directory basename. / ディレクトリ名
 * @returns The task id, or null when the name doesn't follow the convention.
 */
export function parseTaskIdFromWorktreeName(dirName: string): number | null {
  const m = dirName.match(/^task-(\d+)-/);
  if (!m) return null;
  const id = parseInt(m[1], 10);
  return Number.isInteger(id) ? id : null;
}

/**
 * List the worktree paths that must NOT be removed: those owned by a task
 * that is not terminal (a blocked task's worktree is kept too — the user may
 * unblock and resume, and deleting it would repeat the lost-work bug), plus
 * any directory whose ownership can't be determined (unknown = don't delete).
 *
 * Best-effort: on any failure it returns EVERY worktree dir (fail-safe:
 * when in doubt, delete nothing).
 *
 * @param baseDir - Main repository root. / リポジトリルート
 * @returns Absolute worktree paths to protect. / 保護対象の絶対パス
 */
export async function computeWorktreeKeepPaths(baseDir: string): Promise<string[]> {
  const worktreeRoot = join(baseDir, WORKTREE_DIR);
  let dirs: string[];
  try {
    dirs = await readdir(worktreeRoot);
  } catch {
    return []; // no .worktrees dir — nothing to protect
  }
  if (dirs.length === 0) return [];

  try {
    const byId = new Map<number, string[]>();
    const unparseable: string[] = [];
    for (const dir of dirs) {
      const taskId = parseTaskIdFromWorktreeName(dir);
      if (taskId === null) {
        unparseable.push(join(worktreeRoot, dir));
        continue;
      }
      const list = byId.get(taskId) ?? [];
      list.push(join(worktreeRoot, dir));
      byId.set(taskId, list);
    }

    const liveTasks = await prisma.task.findMany({
      where: { id: { in: [...byId.keys()] }, status: { notIn: TERMINAL_STATUSES } },
      select: { id: true },
    });

    const keep = [...unparseable];
    for (const { id } of liveTasks) keep.push(...(byId.get(id) ?? []));

    if (keep.length > 0) {
      log.info(
        { keepCount: keep.length, totalDirs: dirs.length },
        '[worktree-keep-list] Protecting live-task worktrees from stale cleanup',
      );
    }
    return keep;
  } catch (err) {
    // Fail-safe: if liveness can't be determined, protect everything.
    log.warn(
      { err },
      '[worktree-keep-list] Keep-list computation failed — protecting ALL worktrees',
    );
    return dirs.map((d) => join(worktreeRoot, d));
  }
}
