/**
 * worktree-branch-delete
 *
 * Deletes a removed worktree's local branch only when no work is lost: merged,
 * squash-merged into a base on the remote, or every commit pushed. Otherwise
 * the branch is kept and a person is told how to recover it.
 * Not responsible for removing the worktree directory (worktree-remove.ts).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '../../../../../config/logger';

const execFileAsync = promisify(execFile);
const logger = createLogger('git-operations/worktree-ops');
const GIT_OP_TIMEOUT_MS = 60_000;

/** Remote bases a task branch is merged into. */
const SQUASH_BASES = ['origin/develop', 'origin/main', 'origin/master'];

const git = async (cwd: string, args: string[]) =>
  (await execFileAsync('git', args, { cwd, encoding: 'utf8', timeout: GIT_OP_TIMEOUT_MS })).stdout;

/**
 * Whether the branch's whole change already landed on a remote base as one
 * squash commit. A squash merge leaves the branch's own commits on no remote,
 * so without this every auto-merged task branch was kept and warned about.
 *
 * @param cwd - Repository directory / リポジトリ
 * @param branch - Local branch / ローカルブランチ
 * @returns True when a base carries an equivalent patch / 取り込み済みなら true
 */
export async function isBranchSquashMerged(cwd: string, branch: string): Promise<boolean> {
  for (const base of SQUASH_BASES) {
    try {
      await git(cwd, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
    } catch {
      continue;
    }
    try {
      const mergeBase = (await git(cwd, ['merge-base', base, branch])).trim();
      const tree = (await git(cwd, ['rev-parse', `${branch}^{tree}`])).trim();
      // The branch's total change as one commit, so `git cherry` can compare
      // its patch id with the squash commit on the base.
      const squashed = (
        await git(cwd, [
          '-c',
          'user.name=rapitas',
          '-c',
          'user.email=rapitas@localhost',
          'commit-tree',
          tree,
          '-p',
          mergeBase,
          '-m',
          'squash probe',
        ])
      ).trim();
      if ((await git(cwd, ['cherry', base, squashed])).trim().startsWith('-')) return true;
    } catch {
      // An unreadable base proves nothing; the next one may.
    }
  }
  return false;
}

/**
 * Delete a removed worktree's branch when that loses no work.
 *
 * @param cwd - Repository directory / リポジトリ
 * @param branch - Local branch / ローカルブランチ
 * @param force - Delete even with unpushed commits / 未 push でも削除する
 */
export async function deleteWorktreeBranch(
  cwd: string,
  branch: string,
  force: boolean,
): Promise<void> {
  try {
    const merged = (await git(cwd, ['branch', '--merged']))
      .split('\n')
      .some((line) => line.trim() === branch || line.trim() === `* ${branch}`);
    if (merged) {
      await git(cwd, ['branch', '-d', branch]);
      logger.info(`[removeWorktree] Deleted merged branch: ${branch}`);
      return;
    }
    // An unmerged branch is only safe to force-delete when every commit is
    // reachable from some remote ref, or its change landed as a squash. Commits
    // that exist NOWHERE else would be destroyed with it — a stop-execution did
    // exactly that to verified, unpushed work (task 536), recovered via reflog.
    const unique = parseInt(
      (await git(cwd, ['rev-list', branch, '--not', '--remotes', '--count'])).trim(),
      10,
    );
    if (!force && Number.isFinite(unique) && unique > 0) {
      if (await isBranchSquashMerged(cwd, branch)) {
        await git(cwd, ['branch', '-D', branch]);
        logger.info(`[removeWorktree] Deleted squash-merged branch: ${branch}`);
        return;
      }
      const tip = (await git(cwd, ['rev-parse', '--short', branch])).trim();
      logger.warn(
        `[removeWorktree] KEEPING unmerged branch ${branch} — ${unique} commit(s) exist on no remote (tip ${tip}). Push or recover (git checkout -b <name> ${tip}) before deleting.`,
      );
      return;
    }
    await git(cwd, ['branch', '-D', branch]);
    logger.info(`[removeWorktree] Force deleted unmerged branch (all commits pushed): ${branch}`);
  } catch (branchError) {
    logger.warn({ err: branchError }, `[removeWorktree] Failed to delete branch ${branch}`);
  }
}
