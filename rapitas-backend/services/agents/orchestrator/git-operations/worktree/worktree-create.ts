/**
 * WorktreeCreate
 *
 * Git worktree creation for isolated task execution: existing-worktree reuse,
 * branch-collision avoidance, .wf-tmp exclusion, and environment preflight.
 * Removal and cleanup are handled by worktree-remove.ts / worktree-cleanup.ts.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createLogger } from '../../../../../config/logger';
import { WORKTREE_DIR } from '../core/safety';
import { ensureGitRepository, validateAndSetupRemote } from './repository-setup';
import { preflightWorktree } from './worktree-preflight';

// NOTE: execFile (array-args, no shell) instead of exec (shell string) — branch
// names, paths, and other caller-controlled values are passed as literal argv
// elements, so shell metacharacters in them can't be interpreted. See
// services/github/gh-client.ts for the established pattern.
const execFileAsync = promisify(execFile);
const logger = createLogger('git-operations/worktree-ops');

// Local git reads/writes normally finish in well under a second; 60s leaves
// generous headroom while still bounding a lock-contention or auth-prompt
// hang so the implementer phase can't sit blocked past its wall-clock budget.
const GIT_OP_TIMEOUT_MS = 60_000;

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
    await execFileAsync('git', ['worktree', 'prune'], {
      cwd: baseDir,
      encoding: 'utf8',
      timeout: GIT_OP_TIMEOUT_MS,
    }).catch(() => {});

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
          { cwd: baseDir, encoding: 'utf8', timeout: GIT_OP_TIMEOUT_MS },
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
          timeout: GIT_OP_TIMEOUT_MS,
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
      // Branch is already checked out in another worktree — create unique branch name.
      // NOTE: When the name already carries this task's `t<taskId>` marker
      // (canonical names from branch-name-generator), appending `task-<id>`
      // again would embed the id twice (the `...-t319-task-319` bug) — use the
      // random shortId instead. Legacy names without the marker keep the old
      // `task-<id>` suffix for backward compatibility.
      // NOTE: Lazy import — a static one would pull branch-name-generator's
      // ai-client dependency chain into every module that loads worktree-ops,
      // breaking unrelated tests whose node-primitive mocks don't cover it.
      const { hasTaskIdMarker } = await import('../../../../../utils/common/branch-name-generator');
      const alreadyTagged = taskId != null && hasTaskIdMarker(branchName, taskId);
      const uniqueSuffix = alreadyTagged ? shortId : taskId ? `task-${taskId}` : `wt-${shortId}`;
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
        timeout: GIT_OP_TIMEOUT_MS,
      },
    );

    if (existingBranch.trim()) {
      logger.info(
        `[createWorktree] Branch ${effectiveBranchName} exists, creating worktree at ${worktreePath}`,
      );
      await execFileAsync('git', ['worktree', 'add', worktreePath, effectiveBranchName], {
        cwd: baseDir,
        encoding: 'utf8',
        timeout: GIT_OP_TIMEOUT_MS,
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
          timeout: GIT_OP_TIMEOUT_MS,
        })
          .then((r) => !!r.stdout.trim())
          .catch(() => false);
        if (originExists) {
          resolvedBase = originRef;
        } else {
          const localExists = await execFileAsync('git', ['branch', '--list', baseBranch], {
            cwd: baseDir,
            encoding: 'utf8',
            timeout: GIT_OP_TIMEOUT_MS,
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
              timeout: GIT_OP_TIMEOUT_MS,
            },
          );
          if (!developCheck.trim()) {
            const { stdout: mainCheck } = await execFileAsync('git', ['branch', '--list', 'main'], {
              cwd: baseDir,
              encoding: 'utf8',
              timeout: GIT_OP_TIMEOUT_MS,
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
          timeout: GIT_OP_TIMEOUT_MS,
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
          timeout: GIT_OP_TIMEOUT_MS,
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
