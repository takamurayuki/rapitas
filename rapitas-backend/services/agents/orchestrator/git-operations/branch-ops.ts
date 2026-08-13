/**
 * GitOperations — Branch Checkout/Create
 *
 * Creates a new branch or checks out an existing one, guarding against
 * primary-worktree mutation and cross-worktree branch conflicts.
 * Not responsible for pull requests or merges.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../../../config/logger';
import { ensureNotPrimaryWorkTree, findConflictingWorktreeForBranch } from './worktree-guard';

// NOTE: execFile (array-args, no shell) instead of exec (shell string) — branch
// names, base branches, and other caller-controlled values are passed as
// literal argv elements, so shell metacharacters in them can't be interpreted.
const execFileAsync = promisify(execFile);
const logger = createLogger('git-operations/branch-ops');

/**
 * Create a new branch and check it out, or check out an existing branch.
 *
 * @param workingDirectory - Repository directory / リポジトリのディレクトリ
 * @param branchName - Branch name to create or check out / 作成またはチェックアウトするブランチ名
 * @returns true on success / 成功時true
 */
export async function createBranch(workingDirectory: string, branchName: string): Promise<boolean> {
  try {
    // Switching/creating a branch on the primary checkout changes the
    // developer's current branch — only do it inside a worktree.
    await ensureNotPrimaryWorkTree(workingDirectory, `switch to branch ${branchName}`);
    const { stdout } = await execFileAsync('git', ['branch', '--list', branchName], {
      cwd: workingDirectory,
    });

    if (stdout.trim()) {
      // NOTE: Before attempting checkout, verify that no OTHER worktree is
      // already using this branch. `git checkout` fails with
      // `fatal: '<branch>' is already used by worktree at '<path>'` when
      // another worktree holds the branch — emitting a spurious ERROR log.
      // findConflictingWorktreeForBranch encapsulates prune + list + resolve
      // comparison so this logic is shared with mergePullRequest post-merge sync.
      const conflictPath = await findConflictingWorktreeForBranch(workingDirectory, branchName);
      if (conflictPath) {
        logger.warn(
          `[createBranch] Branch ${branchName} is already used by worktree at ${conflictPath}, skipping checkout`,
        );
        return false;
      }
      logger.info(`[createBranch] Branch ${branchName} already exists, checking out`);
      await execFileAsync('git', ['checkout', branchName], { cwd: workingDirectory });
    } else {
      logger.info(`[createBranch] Creating new branch ${branchName}`);
      await execFileAsync('git', ['checkout', '-b', branchName], { cwd: workingDirectory });
    }
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Failed to create/checkout branch');
    return false;
  }
}
