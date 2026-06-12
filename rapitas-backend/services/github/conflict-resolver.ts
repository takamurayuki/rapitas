/**
 * PR conflict resolver
 *
 * Resolves a PR's merge conflicts locally without touching the main checkout:
 * in a throwaway git worktree it merges the base branch into the head branch.
 * When the merge is clean (e.g. the branch was just behind base) it pushes the
 * updated head branch. When there are real content conflicts it reports the
 * conflicting files (the caller hands those to an agent to resolve).
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { tmpdir } from 'os';
import { createLogger } from '../../config/logger';

const execAsync = promisify(exec);
const log = createLogger('github:conflict-resolver');

export interface ConflictResolveResult {
  /** True when the base merged cleanly and the head branch was pushed. */
  resolved: boolean;
  /** Conflicting files when not resolved automatically. */
  conflicts: string[];
  /** Human-readable detail. */
  detail: string;
}

/**
 * Merge `baseBranch` into `headBranch` in an isolated worktree. Pushes the head
 * branch when the merge is clean; otherwise aborts and returns the conflicting
 * files. Never touches the caller's working tree.
 *
 * @param workingDirectory - A local checkout of the PR's repo / リポジトリのローカルチェックアウト
 * @param baseBranch - The merge target branch / マージ先ブランチ
 * @param headBranch - The PR's source branch / PRのソースブランチ
 * @returns Whether it resolved cleanly, plus any conflicting files / 解消結果と競合ファイル
 */
export async function resolvePrConflicts(
  workingDirectory: string,
  baseBranch: string,
  headBranch: string,
): Promise<ConflictResolveResult> {
  const stamp = Date.now();
  const wt = join(tmpdir(), `rapitas-conflict-${stamp}`);
  const tmpBranch = `conflict-resolve/${stamp}`;

  try {
    await execAsync(`git fetch origin ${baseBranch} ${headBranch}`, { cwd: workingDirectory });
    await execAsync(`git worktree add "${wt}" -b ${tmpBranch} origin/${headBranch}`, {
      cwd: workingDirectory,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ message, headBranch }, 'Failed to set up conflict-resolution worktree');
    await cleanup(workingDirectory, wt, tmpBranch);
    return { resolved: false, conflicts: [], detail: `worktree の準備に失敗しました: ${message}` };
  }

  try {
    await execAsync(`git merge origin/${baseBranch} --no-edit`, { cwd: wt });
    // Clean merge — push the updated head branch.
    await execAsync(`git push origin ${tmpBranch}:${headBranch}`, { cwd: wt });
    return {
      resolved: true,
      conflicts: [],
      detail: `${baseBranch} を取り込み、${headBranch} を更新しました`,
    };
  } catch {
    // Conflict (or push failure). Collect the conflicting files, then abort.
    let conflicts: string[] = [];
    try {
      const { stdout } = await execAsync('git diff --name-only --diff-filter=U', { cwd: wt });
      conflicts = stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      /* ignore */
    }
    await execAsync('git merge --abort', { cwd: wt }).catch(() => {});
    return {
      resolved: false,
      conflicts,
      detail: conflicts.length ? `${conflicts.length}件の競合があります` : 'マージできませんでした',
    };
  } finally {
    await cleanup(workingDirectory, wt, tmpBranch);
  }
}

/** Remove the throwaway worktree and temp branch (best-effort). */
async function cleanup(workingDirectory: string, wt: string, tmpBranch: string): Promise<void> {
  await execAsync(`git worktree remove "${wt}" --force`, { cwd: workingDirectory }).catch(() => {});
  await execAsync(`git branch -D ${tmpBranch}`, { cwd: workingDirectory }).catch(() => {});
}
