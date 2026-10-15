/**
 * WorktreeFilesystemOrphans
 *
 * Reclaims directories under `.worktrees/` that git no longer tracks, which the
 * database-driven sweep cannot see.
 * Deliberately removes only EMPTY directories — see the rmdir note below.
 *
 * A nonempty directory is therefore REPORTED, never removed, and that report is
 * aggregated: the refusal is the safety check working, so it is logged once per
 * sweep with the owning task ids rather than as a stack trace per directory.
 * Measured 2026-10-13, eight preserved orphans emitted eight warnings on every
 * cycle — all of them the expected outcome, and loud enough to bury the
 * warnings that do need acting on.
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { createLogger } from '../../../../../config/logger';
import { WORKTREE_DIR, normalizePath, isPathSafeForWorktreeOperation } from '../core/safety';
import { listRegisteredWorktrees } from './worktree-git-list';

const logger = createLogger('git-operations/worktree-ops');

/**
 * Why a directory was left in place: the designed refusal, or a real problem.
 */
export type OrphanPreservation = 'nonempty' | 'inaccessible';

/** rmdir's way of saying "not empty" — ENOTEMPTY on Linux/Windows, EEXIST on some BSDs. */
const NONEMPTY_CODES = new Set(['ENOTEMPTY', 'EEXIST']);

/**
 * Classify why `rmdir` refused an orphan directory.
 *
 * A nonempty refusal is this module's safety check WORKING, not a failure: git
 * metadata being gone is no proof the directory holds no work, and a recursive
 * delete would follow the `node_modules` junction into the main checkout's
 * dependency tree. Reporting it as a warning (with a stack, once per directory,
 * every sweep) buried the warnings that do need acting on — measured
 * 2026-10-13: 8 preserved orphans producing 8 stack traces per cycle, all of
 * them the expected outcome.
 *
 * Anything else means the sweep could not even evaluate the directory, which is
 * worth a warning. Unrecognised and malformed errors fall to 'inaccessible':
 * calling an unknown failure "expected" is the mistake that hides problems.
 *
 * @param error - Whatever rmdir rejected with / rmdir が投げたもの
 * @returns Which kind of preservation this was / 保存理由の種別
 */
export function classifyPreservation(error: unknown): OrphanPreservation {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' && NONEMPTY_CODES.has(code) ? 'nonempty' : 'inaccessible';
}

/** `task-<id>-<hash>`; other worktree names (wt-, redcheck-, triage-) carry no task. */
const TASK_DIR_NAME = /^task-(\d+)-/;

/**
 * The owning task id encoded in a worktree directory name.
 *
 * Once git's metadata is gone the directory name is the only remaining record
 * of what the leftovers belong to, so the summary can still name what an
 * operator would be reclaiming.
 *
 * @param dirName - Directory name under `.worktrees/` / ディレクトリ名
 * @returns The task id, or null when the name encodes none / タスクID、無ければ null
 */
export function parseWorktreeTaskId(dirName: string): number | null {
  const match = TASK_DIR_NAME.exec(dirName);
  if (!match) return null;
  const id = Number.parseInt(match[1], 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Remove `.worktrees/` directories git has no record of.
 *
 * @param baseDir - The main repository root / メインリポジトリのルート
 * @param keepSet - Normalized paths of still-live worktrees, never touched / 稼働中パス（正規化済み）
 * @returns Number of directories removed / 削除したディレクトリ数
 */
export async function sweepFilesystemOrphans(
  baseDir: string,
  keepSet: ReadonlySet<string>,
): Promise<number> {
  const worktreeDir = join(baseDir, WORKTREE_DIR);
  if (!existsSync(worktreeDir)) return 0;

  let cleanedCount = 0;
  try {
    const gitTrackedPaths = new Set(
      (await listRegisteredWorktrees(baseDir)).map((w) => w.normalized),
    );

    const dirEntries = await fsPromises.readdir(worktreeDir, { withFileTypes: true });
    let keptDirCount = 0;
    const preserved: string[] = [];

    for (const dirEntry of dirEntries) {
      if (!dirEntry.isDirectory()) continue;

      const dirPath = join(worktreeDir, dirEntry.name);
      const normalizedDirPath = normalizePath(dirPath);

      if (keepSet.has(normalizedDirPath)) {
        // Per-item "nothing to do" noise — one line per still-live task on
        // every cleanup cycle. Debug-only; see the summary below.
        logger.debug(
          `[cleanupOrphanedWorktrees] Skipping filesystem orphan — owning task is still live: ${dirPath}`,
        );
        keptDirCount++;
        continue;
      }
      // A directory git still tracks is not an orphan. NOTE: `git worktree
      // list` can transiently omit a genuinely-live worktree (e.g. mid-operation
      // on the shared .git metadata from a concurrent commit elsewhere in the
      // same repo); the keepSet check above is what keeps that gap from
      // deleting an in-use directory with no DB check at all.
      if (gitTrackedPaths.has(normalizedDirPath)) continue;

      if (!isPathSafeForWorktreeOperation(dirPath, baseDir)) {
        logger.warn(`[cleanupOrphanedWorktrees] Skipped unsafe path: ${dirPath}`);
        continue;
      }

      // Missing Git metadata is not proof that the directory has no work.
      // Non-recursive rmdir atomically refuses any nonempty directory.
      try {
        await fsPromises.rmdir(dirPath);
        cleanedCount++;
        logger.info(`[cleanupOrphanedWorktrees] Removed empty orphan directory: ${dirPath}`);
      } catch (error) {
        if (classifyPreservation(error) === 'nonempty') {
          // Expected: collected for one summary below instead of a stack per
          // directory per sweep.
          preserved.push(dirEntry.name);
        } else {
          logger.warn(
            { err: error, dirPath },
            '[cleanupOrphanedWorktrees] Could not evaluate orphan directory (not a nonempty refusal)',
          );
        }
      }
    }

    if (keptDirCount > 0) {
      logger.info(
        `[cleanupOrphanedWorktrees] Kept ${keptDirCount} filesystem-orphan dir(s) (owning tasks still live)`,
      );
    }

    if (preserved.length > 0) {
      // Named, so the leftovers are actionable rather than merely recurring: the
      // directory name is the last record of the owning task once git's
      // metadata is gone. Reclaiming them is a human step — unlink the
      // node_modules junction first, THEN delete, or a recursive remove walks
      // into the main checkout's shared tree.
      const tasks = preserved
        .map(parseWorktreeTaskId)
        .filter((id): id is number => id !== null)
        .sort((a, b) => a - b);
      logger.info(
        {
          count: preserved.length,
          tasks,
          dirs: preserved,
        },
        '[cleanupOrphanedWorktrees] Preserved nonempty orphan dir(s) — emptiness cannot be proven without git metadata, so reclaiming is a manual step',
      );
    }
  } catch (error) {
    logger.warn({ err: error }, '[cleanupOrphanedWorktrees] Failed to check filesystem orphans');
  }

  return cleanedCount;
}
