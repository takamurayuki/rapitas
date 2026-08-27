/**
 * PR conflict resolver
 *
 * Resolves a PR's merge conflicts locally without touching the main checkout:
 * in a throwaway git worktree it merges the base branch into the head branch.
 * When the merge is clean (e.g. the branch was just behind base) it pushes the
 * updated head branch. When there are real content conflicts it reports the
 * conflicting files (the caller hands those to an agent to resolve).
 */

import { join } from 'path';
import { tmpdir } from 'os';
import { createLogger } from '../../config/logger';
import { runGitCommand } from './git-exec';

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
    await runGitCommand(['fetch', 'origin', baseBranch, headBranch], workingDirectory);
    await runGitCommand(
      ['worktree', 'add', wt, '-b', tmpBranch, `origin/${headBranch}`],
      workingDirectory,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ message, headBranch }, 'Failed to set up conflict-resolution worktree');
    await cleanup(workingDirectory, wt, tmpBranch);
    return { resolved: false, conflicts: [], detail: `worktree の準備に失敗しました: ${message}` };
  }

  try {
    await runGitCommand(['merge', `origin/${baseBranch}`, '--no-edit'], wt);
    // Clean merge — push the updated head branch.
    await runGitCommand(['push', 'origin', `${tmpBranch}:${headBranch}`], wt);
    return {
      resolved: true,
      conflicts: [],
      detail: `${baseBranch} を取り込み、${headBranch} を更新しました`,
    };
  } catch {
    // Conflict (or push failure). Collect the conflicting files, then abort.
    let conflicts: string[] = [];
    try {
      const stdout = await runGitCommand(['diff', '--name-only', '--diff-filter=U'], wt);
      conflicts = stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      /* ignore */
    }
    // NOTE: skipLog suppresses the ERROR runGitCommand would emit — this abort
    // is best-effort cleanup and its result is never inspected by the caller.
    await runGitCommand(['merge', '--abort'], wt, { skipLog: true }).catch(() => {});
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
  await runGitCommand(['worktree', 'remove', wt, '--force'], workingDirectory).catch(() => {});
  await runGitCommand(['branch', '-D', tmpBranch], workingDirectory).catch(() => {});
}
