/**
 * GitOperations — Worktree Guard
 *
 * Single source of truth for "is this the PRIMARY git working tree?" and a guard
 * that REFUSES agent git mutations on it. Agent commits / branch switches must
 * run in a dedicated `git worktree`; if they run on the primary checkout they
 * stage and commit the developer's own uncommitted work (`git add -A`), and the
 * pre-commit hook's lint-staged stash + a branch checkout can strand that work
 * in a dangling stash. This actually happened (see the main-checkout clobber
 * incident). Refusing fails safe — the task errors with a clear cause instead of
 * destroying work.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../../../config/logger';

const execAsync = promisify(exec);
const logger = createLogger('git-operations/worktree-guard');

/**
 * Whether a directory is the PRIMARY git working tree (not a linked worktree).
 * A linked worktree has git-dir (`.git/worktrees/<name>`) != git-common-dir
 * (the shared `.git`); the primary tree has them equal.
 *
 * @param workingDirectory - Directory to test. / 判定対象ディレクトリ
 * @returns true on the primary tree, or when detection fails (fail safe). / プライマリなら true（判定失敗時も安全側でtrue）
 */
export async function isPrimaryWorkTree(workingDirectory: string): Promise<boolean> {
  try {
    const [gitDir, commonDir] = await Promise.all([
      execAsync('git rev-parse --absolute-git-dir', { cwd: workingDirectory }),
      execAsync('git rev-parse --git-common-dir', { cwd: workingDirectory }),
    ]);
    const normalize = (p: string) => p.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    let common = normalize(commonDir.stdout);
    // --git-common-dir may be relative (e.g. ".git"); resolve against the dir.
    if (!/^([a-zA-Z]:)?\//.test(common)) {
      const root = await execAsync('git rev-parse --show-toplevel', { cwd: workingDirectory });
      common = normalize(`${normalize(root.stdout)}/${common}`);
    }
    return normalize(gitDir.stdout) === common;
  } catch (error) {
    logger.warn(
      { err: error, workingDirectory },
      '[worktree-guard] Could not determine worktree type; treating as primary (fail safe)',
    );
    return true;
  }
}

/**
 * Throw if `workingDirectory` is the primary working tree. Use before any agent
 * git mutation (commit / branch create / branch switch) so it never clobbers the
 * developer's checkout.
 *
 * @param workingDirectory - Directory the mutation would run in. / 操作対象ディレクトリ
 * @param op - Short label of the operation (for the error). / 操作名（エラー用）
 * @param isPrimary - Injectable probe (for tests). / 判定関数（テスト差し替え用）
 * @throws {Error} When the directory is the primary working tree. / プライマリの場合
 */
export async function ensureNotPrimaryWorkTree(
  workingDirectory: string,
  op: string,
  isPrimary: (dir: string) => Promise<boolean> = isPrimaryWorkTree,
): Promise<void> {
  if (await isPrimary(workingDirectory)) {
    throw new Error(
      `Refusing to ${op} in the PRIMARY git working tree (${workingDirectory}). ` +
        'Agent git operations must run in a dedicated worktree — doing this on the ' +
        "primary checkout would stage/commit or clobber the developer's uncommitted work.",
    );
  }
}
