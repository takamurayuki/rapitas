/**
 * GitOperations — Working Tree Revert
 *
 * Hard-reverts all uncommitted changes in a worktree (never the primary
 * checkout). Protects .worktrees/ and .agent-pids/ from deletion.
 * Not responsible for branch/PR operations.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../../../../config/logger';
import { isPrimaryWorkTree } from '../worktree/worktree-guard';

// NOTE: execFile (array-args, no shell) instead of exec (shell string) — the
// working directory is a caller-controlled value passed as a literal argv
// element, so shell metacharacters in it can't be interpreted.
const execFileAsync = promisify(execFile);
const logger = createLogger('git-operations/revert-ops');

/**
 * Revert all changes in a working directory.
 * Protects .worktrees/ and .agent-pids/ directories from being deleted by git clean.
 *
 * @param workingDirectory - Directory to revert changes in / 変更をリバートするディレクトリ
 * @returns true if revert succeeded / リバート成功時true
 */
export async function revertChanges(workingDirectory: string): Promise<boolean> {
  try {
    // SAFETY GATE: `git checkout -- .` + `git clean -fd` are DESTRUCTIVE — they
    // discard ALL uncommitted changes and delete ALL untracked files in the
    // target. That is only acceptable inside a DEDICATED agent worktree. If this
    // ever runs on the PRIMARY working tree (e.g. rapitas self-development where
    // the theme's workingDirectory is the main checkout), it wipes the
    // developer's own in-progress work. This actually happened: a stop reverted
    // the main checkout and destroyed a whole session of uncommitted edits.
    //
    // A linked worktree has git-dir (`.git/worktrees/<name>`) != git-common-dir
    // (the shared `.git`); the PRIMARY worktree has them equal. Refuse to revert
    // the primary worktree.
    if (await isPrimaryWorkTree(workingDirectory)) {
      logger.warn(
        { workingDirectory },
        '[revertChanges] Refusing to hard-revert the PRIMARY working tree — this would destroy uncommitted developer work. Agent changes (if any) are left in place; isolate agent runs in a worktree instead.',
      );
      return false;
    }

    await execFileAsync('git', ['reset', 'HEAD'], { cwd: workingDirectory });
    await execFileAsync('git', ['checkout', '--', '.'], { cwd: workingDirectory });
    // NOTE: Use -fd (not -fdx) and explicitly exclude .worktrees/ to prevent deleting active worktrees.
    // Also exclude .agent-pids/ to avoid breaking process tracking.
    await execFileAsync('git', ['clean', '-fd', '-e', '.worktrees', '-e', '.agent-pids'], {
      cwd: workingDirectory,
    });
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Failed to revert changes');
    return false;
  }
}
