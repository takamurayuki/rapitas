/**
 * worktree-utils
 *
 * Pure functions for determining whether a given directory is an isolated
 * per-task git worktree. Isolated here so that unit tests can import the
 * real implementation instead of duplicating the guard logic.
 * Not responsible for I/O, database access, or git commands.
 */

/**
 * True only for an isolated per-task git worktree (under `.worktrees/`), never
 * the main checkout. A destructive `git reset --hard` / `git clean -fd` must
 * NEVER run on the main repo — research/non-impl phases run in process.cwd()
 * (the main checkout), and reverting there wipes the user's (and the agent
 * platform's) UNCOMMITTED work. Guard every revert with this.
 *
 * @param dir - The execution directory to test / 実行ディレクトリ
 * @returns true when dir is an isolated worktree / 隔離worktreeなら true
 */
export function isIsolatedWorktree(dir: string): boolean {
  return dir.replace(/[\\/]+/g, '/').includes('/.worktrees/');
}
