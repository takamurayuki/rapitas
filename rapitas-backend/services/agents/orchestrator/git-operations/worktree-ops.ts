/**
 * GitOperations — Worktree Operations
 *
 * Git worktree lifecycle management: create, remove, and cleanup of stale entries.
 * Repository and remote initialization is handled by repository-setup.ts.
 * All destructive operations are guarded by isPathSafeForWorktreeOperation from safety.ts.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createLogger } from '../../../../config/logger';
import { WORKTREE_DIR, normalizePath, isPathSafeForWorktreeOperation } from './safety';
import { ensureGitRepository, validateAndSetupRemote } from './repository-setup';
import { clearGitCache } from './git-exec';
import { clearGitRemoteCache } from '../../../github/git-exec';
import {
  clearWorktreeDependenciesTracking,
  awaitWorktreeDependencies,
} from './dependency-installer';
import { preflightWorktree } from './worktree-preflight';
import { prisma } from '../../../../config/database';

export { ensureGitRepository, validateAndSetupRemote };

// NOTE: execFile (array-args, no shell) instead of exec (shell string) — branch
// names, paths, and other caller-controlled values are passed as literal argv
// elements, so shell metacharacters in them can't be interpreted. See
// services/github/gh-client.ts for the established pattern.
const execFileAsync = promisify(execFile);
const logger = createLogger('git-operations/worktree-ops');

/**
 * Remove a directory with exponential-backoff retry to absorb Windows EBUSY errors.
 * Does NOT throw — callers decide how to handle a false return value.
 *
 * @param dirPath - Absolute path to remove / 削除する絶対パス
 * @param opts.maxAttempts - Maximum attempts before giving up (default: 5) / 最大試行回数（デフォルト: 5）
 * @param opts.sleepFn - Delay function between retries; inject a no-op in tests to avoid real waits / テスト時に即時解決の関数を渡してリアル待機を回避できる
 * @returns true when removal succeeded, false when all attempts failed / 成功でtrue、全失敗でfalse
 */
export async function rmDirWithRetry(
  dirPath: string,
  opts?: { maxAttempts?: number; sleepFn?: (ms: number) => Promise<void> },
): Promise<boolean> {
  const maxAttempts = opts?.maxAttempts ?? 5;
  // NOTE: Default uses exponential backoff (1 s, 2 s, 3 s, 4 s…). Override in tests.
  const sleepFn = opts?.sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fsPromises.rm(dirPath, { recursive: true, force: true });
      return true;
    } catch (err) {
      if (attempt < maxAttempts) {
        logger.debug(
          { err, attempt, maxAttempts, dirPath },
          `[rmDirWithRetry] rm attempt ${attempt}/${maxAttempts} failed, retrying in ${attempt}s`,
        );
        await sleepFn(1000 * attempt);
      } else {
        logger.warn(
          { err, dirPath },
          `[rmDirWithRetry] All ${maxAttempts} attempts failed for ${dirPath}`,
        );
      }
    }
  }
  return false;
}

/**
 * Create a git worktree with a new branch for isolated task execution.
 *
 * @param baseDir - The main repository root / メインリポジトリのルート
 * @param branchName - Branch name to create in the worktree / worktree内に作成するブランチ名
 * @param taskId - Task ID used to generate the worktree directory name / ディレクトリ名生成用タスクID
 * @param repositoryUrl - Expected remote URL for validation / 検証用の期待されるリモートURL
 * @returns Absolute path to the created worktree / 作成されたworktreeの絶対パス
 * @throws {Error} When git worktree add fails / git worktree addが失敗した場合
 */
export async function createWorktree(
  baseDir: string,
  branchName: string,
  taskId?: number,
  repositoryUrl?: string | null,
  baseBranch?: string | null,
): Promise<string> {
  const isRepo = await ensureGitRepository(baseDir, repositoryUrl);
  if (!isRepo) {
    throw new Error(`Failed to initialize Git repository at ${baseDir}`);
  }

  const isRemoteValid = await validateAndSetupRemote(baseDir, repositoryUrl);
  if (!isRemoteValid && repositoryUrl) {
    logger.warn(`[createWorktree] Remote validation failed, proceeding anyway`);
  }

  const shortId = randomBytes(4).toString('hex');
  const dirName = taskId ? `task-${taskId}-${shortId}` : `wt-${shortId}`;
  const worktreePath = join(baseDir, WORKTREE_DIR, dirName);
  // NOTE: execFile passes args literally (no shell), so worktreePath needs no
  // quoting even when it contains spaces — quotes would become literal characters.

  try {
    let effectiveBranchName = branchName;
    // Prune stale worktree entries (their dir was deleted on disk but git still
    // lists them). Otherwise a removed worktree makes its branch look "in use"
    // below and forces a divergent unique branch — orphaning the PR's commits on
    // a ci_repair re-run that means to reuse the existing feature branch.
    await execFileAsync('git', ['worktree', 'prune'], { cwd: baseDir, encoding: 'utf8' }).catch(
      () => {},
    );

    // Ground-truth reuse: if THIS task already has a live worktree registered
    // in git, reuse it directly instead of going through branch-name
    // generation at all. This does NOT rely on the app database recording a
    // prior session — callers (e.g. execute-setup.ts) already look up a
    // reusable worktree from their own session history, but that lookup can
    // come up empty for reasons unrelated to whether the worktree is still
    // genuinely alive (task 513 regression, round 3: the backend was
    // restarted from Postgres mode into SQLite desktop mode between retries,
    // and the fresh SQLite database had no memory of the session that
    // created this worktree — the physical worktree and its git branch were
    // completely unaffected by that switch). Checking git's own bookkeeping
    // is the one source of truth neither database swap nor a lost/failed
    // session row can desync from.
    if (taskId) {
      try {
        const { stdout: worktreeList } = await execFileAsync(
          'git',
          ['worktree', 'list', '--porcelain'],
          { cwd: baseDir, encoding: 'utf8' },
        );
        const taskDirPattern = new RegExp(`[\\\\/]task-${taskId}-[^\\\\/]+$`);
        for (const line of worktreeList.split('\n')) {
          if (!line.startsWith('worktree ')) continue;
          const existingPath = line.slice('worktree '.length).trim();
          if (
            taskDirPattern.test(existingPath) &&
            existsSync(existingPath) &&
            existsSync(join(existingPath, '.git'))
          ) {
            logger.info(
              `[createWorktree] Found existing live worktree for task ${taskId} at ${existingPath} — reusing instead of creating a new one`,
            );
            return existingPath;
          }
        }
      } catch (probeError) {
        logger.debug(`[createWorktree] Existing-worktree probe failed, proceeding: ${probeError}`);
      }
    }

    let branchInUse = false;
    try {
      const { stdout: worktreeList } = await execFileAsync(
        'git',
        ['worktree', 'list', '--porcelain'],
        {
          cwd: baseDir,
          encoding: 'utf8',
        },
      );

      branchInUse = worktreeList.includes(`branch refs/heads/${branchName}`);
    } catch (listError) {
      // Fail SAFE, not silently: this probe existing is what stops two
      // worktrees fighting over the same branch. Swallowing the failure and
      // proceeding as "branch is free" let a real collision through as an
      // unhandled `git worktree add` fatal error (task 513 regression) —
      // treat "couldn't check" the same as "assume in use" instead.
      logger.warn(
        `[createWorktree] Could not check worktree list, assuming branch may be in use: ${listError}`,
      );
      branchInUse = true;
    }

    if (branchInUse) {
      // Branch is already checked out in another worktree — create unique branch name
      const uniqueSuffix = taskId ? `task-${taskId}` : `wt-${shortId}`;
      effectiveBranchName = `${branchName}-${uniqueSuffix}`;
      logger.warn(
        `[createWorktree] Branch ${branchName} is already in use, using ${effectiveBranchName} instead`,
      );
    }

    const { stdout: existingBranch } = await execFileAsync(
      'git',
      ['branch', '--list', effectiveBranchName],
      {
        cwd: baseDir,
        encoding: 'utf8',
      },
    );

    if (existingBranch.trim()) {
      logger.info(
        `[createWorktree] Branch ${effectiveBranchName} exists, creating worktree at ${worktreePath}`,
      );
      await execFileAsync('git', ['worktree', 'add', worktreePath, effectiveBranchName], {
        cwd: baseDir,
        encoding: 'utf8',
      });
    } else {
      let parentBranch = 'develop';
      // Prefer the explicitly chosen base branch (from the execute form /
      // theme default). Cut from origin/<base> when present so the feature
      // branch starts at the up-to-date remote tip; else the local branch.
      // Fall back to the develop→main→master heuristic when the chosen base
      // can't be resolved (keeps branch-from === PR-into for the common case).
      let resolvedBase: string | null = null;
      if (baseBranch) {
        const originRef = `origin/${baseBranch}`;
        const originExists = await execFileAsync('git', ['branch', '-r', '--list', originRef], {
          cwd: baseDir,
          encoding: 'utf8',
        })
          .then((r) => !!r.stdout.trim())
          .catch(() => false);
        if (originExists) {
          resolvedBase = originRef;
        } else {
          const localExists = await execFileAsync('git', ['branch', '--list', baseBranch], {
            cwd: baseDir,
            encoding: 'utf8',
          })
            .then((r) => !!r.stdout.trim())
            .catch(() => false);
          if (localExists) resolvedBase = baseBranch;
        }
        if (!resolvedBase) {
          logger.warn(
            `[createWorktree] Requested base branch "${baseBranch}" not found (origin or local); falling back to default detection`,
          );
        }
      }

      if (resolvedBase) {
        parentBranch = resolvedBase;
      } else {
        try {
          const { stdout: developCheck } = await execFileAsync(
            'git',
            ['branch', '--list', 'develop'],
            {
              cwd: baseDir,
              encoding: 'utf8',
            },
          );
          if (!developCheck.trim()) {
            const { stdout: mainCheck } = await execFileAsync('git', ['branch', '--list', 'main'], {
              cwd: baseDir,
              encoding: 'utf8',
            });
            parentBranch = mainCheck.trim() ? 'main' : 'master';
          }
        } catch {
          parentBranch = 'main';
        }
      }

      logger.info(
        `[createWorktree] Creating worktree at ${worktreePath} with new branch ${effectiveBranchName} from ${parentBranch}`,
      );
      await execFileAsync(
        'git',
        ['worktree', 'add', '-b', effectiveBranchName, worktreePath, parentBranch],
        {
          cwd: baseDir,
          encoding: 'utf8',
        },
      );
    }

    logger.info(
      `[createWorktree] Worktree created: ${worktreePath} (branch: ${effectiveBranchName})`,
    );

    // Ignore the agent's transient workflow temp file. claude-code writes
    // `.wf-tmp.md` into the working dir and curl's it to the workflow API
    // (see prompt-builder.ts); the file then lingered in the worktree and
    // showed up as the ONLY "changed file" in verify reports / auto-commits
    // (e.g. "変更: 1件 + .wf-tmp.md"). Adding it to the worktree-local git
    // exclude keeps it out of status / diff / `git add .` entirely.
    try {
      const { stdout: excludeRel } = await execFileAsync(
        'git',
        ['rev-parse', '--git-path', 'info/exclude'],
        {
          cwd: worktreePath,
          encoding: 'utf8',
        },
      );
      let excludePath = excludeRel.trim();
      if (!excludePath.match(/^([a-zA-Z]:[\\/]|[\\/])/)) {
        excludePath = join(worktreePath, excludePath);
      }
      await fsPromises.mkdir(join(excludePath, '..'), { recursive: true });
      await fsPromises.appendFile(
        excludePath,
        '\n# rapitas agent transient files\n.wf-tmp.md\n.wf-tmp*\n',
        'utf8',
      );
    } catch (excErr) {
      logger.warn(
        { err: excErr, worktreePath },
        '[createWorktree] Failed to add .wf-tmp.md to git exclude (non-fatal)',
      );
    }

    // Environment preflight: auto-run setup-worktree.cjs (previously a manual
    // CLAUDE.md rule agents forgot) and fail fast on a broken managed env.
    await preflightWorktree(worktreePath);

    // NOTE: Dependency install is intentionally NOT awaited here. The caller
    // (executeRoute) decides whether/when to install based on task heuristics
    // and awaits via `awaitWorktreeDependencies(worktreePath)` just before
    // launching the agent CLI — keeping the HTTP response fast.
    return worktreePath;
  } catch (error) {
    logger.error(
      { err: error },
      `[createWorktree] Failed to create worktree for branch ${branchName}`,
    );
    throw error;
  }
}

/**
 * Remove a git worktree and prune stale entries.
 *
 * @param baseDir - The main repository root / メインリポジトリのルート
 * @param worktreePath - Absolute path to the worktree to remove / 削除するworktreeの絶対パス
 * @param deleteBranch - Whether to delete the associated branch (default: true) / 関連するブランチを削除するか（デフォルト: true）
 */
export async function removeWorktree(
  baseDir: string,
  worktreePath: string,
  deleteBranch: boolean = true,
): Promise<void> {
  // NOTE: Validate path before any destructive operation — prevents accidental deletion of .git/ or main repo
  if (!isPathSafeForWorktreeOperation(worktreePath, baseDir)) {
    logger.error(
      `[removeWorktree] REFUSED to remove unsafe path: ${worktreePath} (baseDir: ${baseDir})`,
    );
    return;
  }

  // NOTE: Wait for any in-flight dependency setup (setup-worktree.cjs) to complete before
  // tearing down the directory. On Windows a running node process holds handles inside
  // node_modules and causes EBUSY on the subsequent rm. When no setup is in flight
  // (e.g. after a backend restart) awaitWorktreeDependencies starts a brief idempotent
  // link-check that resolves within seconds, so rm proceeds safely either way.
  try {
    await awaitWorktreeDependencies(worktreePath);
  } catch {
    // NOTE: Setup failure is non-fatal for removal — the worker may never have needed it.
    logger.debug('[removeWorktree] awaitWorktreeDependencies failed (non-fatal), proceeding');
  }

  let branchName: string | null = null;
  if (deleteBranch) {
    try {
      const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
        cwd: baseDir,
        encoding: 'utf8',
      });

      const entries = stdout.split('\n\n').filter(Boolean);
      for (const entry of entries) {
        const pathMatch = entry.match(/^worktree\s+(.+)$/m);
        const branchMatch = entry.match(/^branch\s+refs\/heads\/(.+)$/m);

        if (pathMatch && branchMatch) {
          const normalizedEntryPath = normalizePath(pathMatch[1]!);
          const normalizedWorktreePath = normalizePath(worktreePath);

          if (normalizedEntryPath === normalizedWorktreePath) {
            branchName = branchMatch[1]!;
            logger.info(`[removeWorktree] Found branch ${branchName} for worktree ${worktreePath}`);
            break;
          }
        }
      }
    } catch (error) {
      logger.warn({ err: error }, `[removeWorktree] Failed to get branch name for worktree`);
    }
  }

  // Unlink the junctions/symlinks (node_modules, etc.) that setup-worktree.cjs
  // created BEFORE removing the worktree. On Windows, leftover junctions confuse
  // `git worktree remove` and `rm -rf`, surfacing as "Filename too long" / EPERM.
  const teardownScript = join(worktreePath, 'scripts', 'setup-worktree.cjs');
  if (existsSync(teardownScript)) {
    try {
      // NOTE: process.execPath (not the string 'node') runs the same Node/Bun
      // binary that is executing this process, and execFile array-args need no
      // quoting for the script path even when it contains spaces.
      await execFileAsync(process.execPath, [teardownScript, '--teardown'], {
        cwd: worktreePath,
        encoding: 'utf8',
      });
      logger.info('[removeWorktree] Unlinked shared resources via setup-worktree.cjs --teardown');
    } catch (tdErr) {
      logger.debug(
        { err: tdErr },
        '[removeWorktree] setup-worktree.cjs --teardown failed (non-fatal)',
      );
    }
  }

  // NOTE: Windows NTFS/junction handles can linger for ~100-200ms after the teardown
  // script closes them. This wait prevents EBUSY on the subsequent git worktree remove.
  await new Promise<void>((r) => setTimeout(r, 200));

  // NOTE: Always run `git worktree prune` BEFORE attempting remove. This
  // clears stale entries left behind by previous failed removes (commonly
  // happens when a long-running codex/install process held a file handle
  // during the prior cleanup). Without this, `git worktree remove` may
  // refuse with "is not a working tree".
  try {
    await execFileAsync('git', ['worktree', 'prune'], { cwd: baseDir, encoding: 'utf8' });
  } catch (preErr) {
    logger.debug({ err: preErr }, '[removeWorktree] pre-prune failed (non-fatal)');
  }

  try {
    await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], {
      cwd: baseDir,
      encoding: 'utf8',
    });
    logger.info(`[removeWorktree] Removed worktree: ${worktreePath}`);
  } catch (error) {
    // NOTE: If git worktree remove fails (e.g., already deleted), try filesystem cleanup
    logger.warn(
      { err: error },
      `[removeWorktree] git worktree remove failed, attempting fs cleanup`,
    );

    if (existsSync(worktreePath)) {
      // NOTE: Double-check that the target is NOT a real .git directory (indicates main repo, not worktree)
      const gitDirPath = join(worktreePath, '.git');
      if (existsSync(gitDirPath)) {
        try {
          const gitStat = await fsPromises.stat(gitDirPath);
          if (gitStat.isDirectory()) {
            // SAFETY: .git is a directory — this is a main repository, NOT a worktree
            // Worktrees have a .git FILE pointing to the main repo's .git/worktrees/ entry
            logger.error(
              `[removeWorktree] REFUSED fs cleanup: ${worktreePath} contains .git directory (likely main repo, not worktree)`,
            );
            return;
          }
        } catch {
          // NOTE: stat failed — proceed with caution, but the path validation above should protect us
        }
      }

      const removed = await rmDirWithRetry(worktreePath);
      if (removed) {
        logger.info(`[removeWorktree] Cleaned up directory: ${worktreePath}`);
      } else {
        logger.warn(
          `[removeWorktree] Could not remove ${worktreePath} after retries (held handles); leaving for the cleanup scheduler`,
        );
      }
    }
  }

  if (deleteBranch && branchName) {
    try {
      const { stdout: mergedBranches } = await execFileAsync('git', ['branch', '--merged'], {
        cwd: baseDir,
        encoding: 'utf8',
      });

      const isMerged = mergedBranches
        .split('\n')
        .some((line) => line.trim() === branchName || line.trim() === `* ${branchName}`);

      if (isMerged) {
        // Use -d for merged branches (safer)
        await execFileAsync('git', ['branch', '-d', branchName], {
          cwd: baseDir,
          encoding: 'utf8',
        });
        logger.info(`[removeWorktree] Deleted merged branch: ${branchName}`);
      } else {
        // An unmerged branch is only safe to force-delete when every commit
        // is reachable from some remote ref (i.e. the work was pushed).
        // Commits that exist NOWHERE else would be destroyed with it — a
        // stop-execution did exactly that to a branch holding verified,
        // committed-but-unpushed work (task 536), recovered only via reflog.
        const { stdout: uniqueCountRaw } = await execFileAsync(
          'git',
          ['rev-list', branchName, '--not', '--remotes', '--count'],
          { cwd: baseDir, encoding: 'utf8' },
        );
        const uniqueCount = parseInt(uniqueCountRaw.trim(), 10);
        if (Number.isFinite(uniqueCount) && uniqueCount > 0) {
          const { stdout: tip } = await execFileAsync('git', ['rev-parse', '--short', branchName], {
            cwd: baseDir,
            encoding: 'utf8',
          });
          logger.warn(
            `[removeWorktree] KEEPING unmerged branch ${branchName} — ${uniqueCount} commit(s) exist on no remote (tip ${tip.trim()}). Push or recover (git checkout -b <name> ${tip.trim()}) before deleting.`,
          );
        } else {
          // All commits are on a remote — -D only drops the local ref.
          await execFileAsync('git', ['branch', '-D', branchName], {
            cwd: baseDir,
            encoding: 'utf8',
          });
          logger.info(
            `[removeWorktree] Force deleted unmerged branch (all commits pushed): ${branchName}`,
          );
        }
      }
    } catch (branchError) {
      logger.warn({ err: branchError }, `[removeWorktree] Failed to delete branch ${branchName}`);
    }
  }

  // Prune stale worktree metadata regardless of removal success
  try {
    await execFileAsync('git', ['worktree', 'prune'], { cwd: baseDir });
  } catch (pruneError) {
    logger.warn({ err: pruneError }, '[removeWorktree] git worktree prune failed');
  }

  // NOTE: Drop install tracking so a future worktree at the same path
  // (after directory reuse) does not see a stale resolved-promise.
  clearWorktreeDependenciesTracking(worktreePath);
  // NOTE: Invalidate cached git-dir values for this path. A new worktree
  // created at the same path would otherwise get the old git-dir from cache.
  clearGitCache(worktreePath);
  // NOTE: Invalidate the GitHub remote URL cache for this path so a future
  // worktree reusing the same directory cannot receive a stale owner/repo.
  clearGitRemoteCache(worktreePath);
}

/**
 * Clean up stale worktrees left over from crashes or abnormal exits.
 * Called during server startup.
 *
 * @param baseDir - The main repository root / メインリポジトリのルート
 * @returns Number of worktrees cleaned up / クリーンアップしたworktreeの数
 */
export async function cleanupStaleWorktrees(
  baseDir: string,
  keepPaths: string[] = [],
): Promise<number> {
  let cleanedCount = 0;

  try {
    await execFileAsync('git', ['worktree', 'prune'], { cwd: baseDir });

    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: baseDir,
      encoding: 'utf8',
    });

    const worktreeDir = join(baseDir, WORKTREE_DIR);
    const normalizedWorktreeDir = normalizePath(worktreeDir);
    const entries = stdout.split('\n\n').filter(Boolean);
    // NOTE: keepPaths is the LIVENESS filter this function historically lacked:
    // despite its name it removed EVERY worktree under .worktrees/, and since
    // it runs on every worker (re)initialization — workers respawn routinely —
    // it wiped the uncommitted work of in-flight tasks (task 494: implementer
    // finished, worker recycled, verifier then saw an empty tree and bounced
    // the task into a repair loop). The caller with DB access supplies the
    // worktrees of non-terminal tasks; those must never be deleted here.
    const keepSet = new Set(keepPaths.map((p) => normalizePath(p)));
    let keptCount = 0;

    for (const entry of entries) {
      const pathMatch = entry.match(/^worktree\s+(.+)$/m);
      if (!pathMatch?.[1]) continue;

      const wtPath = pathMatch[1];
      // NOTE: Use normalized path comparison to handle Windows path separator differences
      const normalizedWtPath = normalizePath(wtPath);
      if (!normalizedWtPath.startsWith(normalizedWorktreeDir + '/')) continue;
      if (keepSet.has(normalizedWtPath)) {
        // Per-item "nothing to do" noise — this runs on every worker (re)init
        // and floods the console with one line per live task. Debug-only; see
        // the keptCount summary below for the at-a-glance signal.
        logger.debug(`[cleanupStaleWorktrees] Keeping live worktree: ${wtPath}`);
        keptCount++;
        continue;
      }

      logger.info(`[cleanupStaleWorktrees] Removing stale worktree: ${wtPath}`);
      try {
        await removeWorktree(baseDir, wtPath);
        cleanedCount++;
      } catch (error) {
        logger.warn({ err: error }, `[cleanupStaleWorktrees] Failed to remove ${wtPath}`);
      }
    }

    if (cleanedCount > 0) {
      logger.info(`[cleanupStaleWorktrees] Cleaned up ${cleanedCount} stale worktrees`);
    }
    if (keptCount > 0) {
      logger.info(`[cleanupStaleWorktrees] Kept ${keptCount} live worktree(s)`);
    }
  } catch (error) {
    logger.error({ err: error }, '[cleanupStaleWorktrees] Failed to clean up stale worktrees');
  }

  return cleanedCount;
}

/**
 * Clean up orphaned worktrees based on database reconciliation and filesystem state.
 * Removes worktrees for completed/failed/cancelled sessions and updates the database.
 *
 * @param baseDir - The main repository root / メインリポジトリのルート
 * @param rmOpts - Options forwarded to rmDirWithRetry (inject sleepFn/maxAttempts in tests to avoid real waits) / テスト時にsleepFnを注入してリアル待機を回避できる
 * @returns Number of worktrees cleaned up / クリーンアップしたworktreeの数
 */
export async function cleanupOrphanedWorktrees(
  baseDir: string,
  rmOpts?: { maxAttempts?: number; sleepFn?: (ms: number) => Promise<void> },
): Promise<number> {
  let cleanedCount = 0;

  // Liveness filter: a worktree whose OWNING TASK is not terminal must survive
  // this cleanup, even if the particular AgentSession row that created it was
  // separately marked completed/failed/cancelled (a self-repair bounce, for
  // instance, leaves a stale session behind while the task keeps running in
  // the same worktree) — see worktree-keep-list.ts. Without this, running
  // this cleanup on every backend startup/restart (any trigger — including an
  // unrelated prisma schema edit — see worktree-cleanup-scheduler.ts /
  // index.ts warmup) could delete a worktree an active verifier was using
  // mid-execution (observed: task 501's implementation directory vanished and
  // was replaced by a `develop` checkout, corrupting the empty-diff check
  // into a false "no changes needed" verdict). Fail-safe: if liveness can't
  // be determined, skip this cleanup cycle entirely rather than risk deleting
  // live work.
  let keepPaths: string[];
  try {
    const { computeWorktreeKeepPaths } = await import('../../worktree-keep-list');
    keepPaths = await computeWorktreeKeepPaths(baseDir);
  } catch (err) {
    logger.warn(
      { err },
      '[cleanupOrphanedWorktrees] Keep-list computation failed — skipping this cleanup cycle',
    );
    return 0;
  }
  const keepSet = new Set(keepPaths.map((p) => normalizePath(p)));

  try {
    // Clean up database-tracked orphaned worktrees
    const orphanedSessions = await prisma.agentSession.findMany({
      where: {
        worktreePath: { not: null },
        status: { in: ['completed', 'failed', 'cancelled'] },
      },
      select: {
        id: true,
        worktreePath: true,
        status: true,
      },
    });

    // Routine bookkeeping, not a signal by itself — the "Cleaned up N" summary
    // below is the line worth seeing; this only helps when actually debugging
    // the reconciliation logic.
    logger.debug(
      `[cleanupOrphanedWorktrees] Found ${orphanedSessions.length} orphaned sessions with worktree paths`,
    );
    let keptSessionCount = 0;

    for (const session of orphanedSessions) {
      if (!session.worktreePath) continue;
      if (keepSet.has(normalizePath(session.worktreePath))) {
        // Per-item "nothing to do" noise — one line per still-live task on
        // every cleanup cycle. Debug-only; see the summary after the loop.
        logger.debug(
          `[cleanupOrphanedWorktrees] Skipping session ${session.id} worktree — owning task is still live: ${session.worktreePath}`,
        );
        keptSessionCount++;
        continue;
      }

      try {
        // Remove the worktree if it exists
        await removeWorktree(baseDir, session.worktreePath);
        cleanedCount++;

        // Clear the worktreePath in the database
        await prisma.agentSession.update({
          where: { id: session.id },
          data: { worktreePath: null },
        });

        logger.info(
          `[cleanupOrphanedWorktrees] Cleaned up worktree for session ${session.id} (${session.status}): ${session.worktreePath}`,
        );
      } catch (error) {
        logger.warn(
          { err: error },
          `[cleanupOrphanedWorktrees] Failed to clean up session ${session.id} worktree: ${session.worktreePath}`,
        );
      }
    }
    if (keptSessionCount > 0) {
      logger.info(
        `[cleanupOrphanedWorktrees] Kept ${keptSessionCount} session worktree(s) (owning tasks still live)`,
      );
    }

    // Also check for filesystem orphans (directories that git no longer tracks)
    const worktreeDir = join(baseDir, WORKTREE_DIR);
    if (existsSync(worktreeDir)) {
      try {
        const { stdout: gitWorktreeList } = await execFileAsync(
          'git',
          ['worktree', 'list', '--porcelain'],
          {
            cwd: baseDir,
            encoding: 'utf8',
          },
        );

        const gitTrackedPaths = new Set<string>();
        const entries = gitWorktreeList.split('\n\n').filter(Boolean);

        for (const entry of entries) {
          const pathMatch = entry.match(/^worktree\s+(.+)$/m);
          if (pathMatch?.[1]) {
            gitTrackedPaths.add(normalizePath(pathMatch[1]));
          }
        }

        // Check filesystem directories against git-tracked worktrees
        const dirEntries = await fsPromises.readdir(worktreeDir, { withFileTypes: true });
        let keptDirCount = 0;

        for (const dirEntry of dirEntries) {
          if (!dirEntry.isDirectory()) continue;

          const dirPath = join(worktreeDir, dirEntry.name);
          const normalizedDirPath = normalizePath(dirPath);

          // If directory exists but is not tracked by git, it's an orphan —
          // UNLESS it belongs to a still-live task. `git worktree list` can
          // transiently omit a genuinely-live worktree (e.g. mid-operation on
          // the shared .git metadata from a concurrent commit elsewhere in
          // the same repo); trusting that gap alone would delete an in-use
          // directory outright, with no DB check at all.
          if (!gitTrackedPaths.has(normalizedDirPath) && !keepSet.has(normalizedDirPath)) {
            if (isPathSafeForWorktreeOperation(dirPath, baseDir)) {
              const removed = await rmDirWithRetry(dirPath, rmOpts);
              if (removed) {
                cleanedCount++;
                logger.info(
                  `[cleanupOrphanedWorktrees] Removed orphaned filesystem directory: ${dirPath}`,
                );
              } else {
                // NOTE: Do NOT throw — one orphan failing must not abort the entire cleanup cycle.
                logger.warn(
                  { dirPath },
                  `[cleanupOrphanedWorktrees] Failed to remove orphaned directory after retries: ${dirPath}`,
                );
              }
            } else {
              logger.warn(`[cleanupOrphanedWorktrees] Skipped unsafe path: ${dirPath}`);
            }
          } else if (keepSet.has(normalizedDirPath)) {
            // Per-item "nothing to do" noise — one line per still-live task on
            // every cleanup cycle. Debug-only; see the summary below.
            logger.debug(
              `[cleanupOrphanedWorktrees] Skipping filesystem orphan — owning task is still live: ${dirPath}`,
            );
            keptDirCount++;
          }
        }
        if (keptDirCount > 0) {
          logger.info(
            `[cleanupOrphanedWorktrees] Kept ${keptDirCount} filesystem-orphan dir(s) (owning tasks still live)`,
          );
        }
      } catch (error) {
        logger.warn(
          { err: error },
          '[cleanupOrphanedWorktrees] Failed to check filesystem orphans',
        );
      }
    }

    if (cleanedCount > 0) {
      logger.info(`[cleanupOrphanedWorktrees] Cleaned up ${cleanedCount} orphaned worktrees`);
    }
  } catch (error) {
    logger.error(
      { err: error },
      '[cleanupOrphanedWorktrees] Failed to clean up orphaned worktrees',
    );
  }

  return cleanedCount;
}
