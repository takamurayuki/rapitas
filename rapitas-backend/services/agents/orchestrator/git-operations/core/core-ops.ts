/**
 * GitOperations — Core Operations
 *
 * Basic git diff, commit, and create-commit operations.
 * Structured per-file diff is in diff-structured.ts.
 * Not responsible for branch management, pull requests, or worktrees.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '../../../../../config/logger';
import { ensureNotPrimaryWorkTree, recoverFromUnresolvedMerge } from '../worktree/worktree-guard';

export { getDiff } from './diff-structured';

// NOTE: execFile (array-args, no shell) instead of exec (shell string) — commit
// messages / task titles are caller-controlled and passed as literal argv
// elements, so shell metacharacters in them can't be interpreted.
const execFileAsync = promisify(execFile);
const logger = createLogger('git-operations/core-ops');

// Local git reads/writes normally finish in well under a second; 60s leaves
// generous headroom while still bounding a lock-contention or auth-prompt
// hang so the implementer phase can't sit blocked past its wall-clock budget.
const GIT_OP_TIMEOUT_MS = 60_000;

/**
 * Delete the agent's transient `.wf-*` files (e.g. `.wf-tmp.md` for workflow
 * file saves, `.wf-concern.json` for concern/idea filing) from the working
 * directory before staging. The agent writes these and curls them to the API,
 * often leaving them behind; the per-worktree git-exclude is unreliable on
 * Windows, so `git add -A` would otherwise stage and commit them — polluting
 * the changed-file list (sometimes the temp file is the ONLY "change"). Best-effort.
 *
 * @param workingDirectory - Worktree root to clean / クリーンするディレクトリ
 */
async function removeTransientWorkflowFiles(workingDirectory: string): Promise<void> {
  try {
    const entries = await readdir(workingDirectory);
    await Promise.all(
      entries
        .filter((name) => name.startsWith('.wf-'))
        .map((name) => unlink(join(workingDirectory, name)).catch(() => {})),
    );
  } catch {
    /* best-effort: directory unreadable or already clean */
  }
}

/**
 * Get the unstaged git diff for a working directory.
 *
 * @param workingDirectory - Directory to diff / diffを取得するディレクトリ
 * @returns Diff string, or empty string on error / diff文字列、エラー時は空文字
 */
export async function getGitDiff(workingDirectory: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['diff'], {
      cwd: workingDirectory,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: GIT_OP_TIMEOUT_MS,
    });
    return stdout;
  } catch (error) {
    logger.error({ err: error }, 'Failed to get git diff');
    return '';
  }
}

/**
 * Get full diff including staged, unstaged changes, and untracked files.
 *
 * @param workingDirectory - Directory to diff / diffを取得するディレクトリ
 * @returns Combined diff string, or empty string on error / 統合diffまたはエラー時は空文字
 */
export async function getFullGitDiff(workingDirectory: string): Promise<string> {
  try {
    const { stdout: staged } = await execFileAsync('git', ['diff', '--cached'], {
      cwd: workingDirectory,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: GIT_OP_TIMEOUT_MS,
    });
    const { stdout: unstaged } = await execFileAsync('git', ['diff'], {
      cwd: workingDirectory,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: GIT_OP_TIMEOUT_MS,
    });
    const { stdout: untracked } = await execFileAsync(
      'git',
      ['ls-files', '--others', '--exclude-standard'],
      {
        cwd: workingDirectory,
        encoding: 'utf8',
        timeout: GIT_OP_TIMEOUT_MS,
      },
    );

    let result = '';
    if (staged) result += '=== Staged Changes ===\n' + staged + '\n';
    if (unstaged) result += '=== Unstaged Changes ===\n' + unstaged + '\n';
    if (untracked.trim()) result += '=== New Files ===\n' + untracked + '\n';

    return result || 'No changes detected';
  } catch (error) {
    logger.error({ err: error }, 'Failed to get full git diff');
    return '';
  }
}

/**
 * Stage all changes and create a commit.
 *
 * @param workingDirectory - Directory to commit in / コミットするディレクトリ
 * @param message - Commit message / コミットメッセージ
 * @param taskTitle - Optional task title appended to commit body / コミット本文に追加する任意のタスクタイトル
 * @returns Result with success flag and commit hash / 成功フラグとコミットハッシュを含む結果
 */
export async function commitChanges(
  workingDirectory: string,
  message: string,
  taskTitle?: string,
): Promise<{ success: boolean; commitHash?: string; error?: string }> {
  try {
    // Never `git add -A` + commit on the primary checkout — it would stage and
    // commit the developer's own uncommitted work. Agent commits run in a worktree.
    await ensureNotPrimaryWorkTree(workingDirectory, 'commit');
    // A merge left unresolved by an earlier pre-pr-base-sync failure (task 691)
    // would otherwise fail `git add` with git's "you need to resolve your
    // current index first" — self-heal before staging.
    await recoverFromUnresolvedMerge(workingDirectory);
    await removeTransientWorkflowFiles(workingDirectory);
    await execFileAsync('git', ['add', '-A'], {
      cwd: workingDirectory,
      timeout: GIT_OP_TIMEOUT_MS,
    });

    const fullMessage = taskTitle
      ? `${message}\n\nTask: ${taskTitle}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`
      : `${message}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`;

    // NOTE: execFile passes fullMessage as a single literal argv element — no
    // shell involved, so the manual quote-escaping needed for a shell string is
    // unnecessary (and the message may contain raw double quotes safely).
    await execFileAsync('git', ['commit', '-m', fullMessage], {
      cwd: workingDirectory,
      encoding: 'utf8',
      timeout: GIT_OP_TIMEOUT_MS,
    });

    const { stdout: hash } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: workingDirectory,
      encoding: 'utf8',
      timeout: GIT_OP_TIMEOUT_MS,
    });

    return { success: true, commitHash: hash.trim() };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Create a full-featured commit with diff stats on a feature branch.
 * Automatically creates a feature branch if currently on main/master/develop.
 *
 * @param workingDirectory - Directory to commit in / コミットするディレクトリ
 * @param message - Commit message / コミットメッセージ
 * @returns Commit metadata including hash, branch, and change stats / ハッシュ・ブランチ・変更統計を含むコミットメタデータ
 */
export async function createCommit(
  workingDirectory: string,
  message: string,
  preferredBaseBranch?: string | null,
): Promise<{
  hash: string;
  branch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  /** True when nothing new was staged and HEAD was returned as-is. / 新規ステージ無しでHEADを返した場合 true */
  alreadyCommitted: boolean;
}> {
  // Refuse on the primary checkout: this both `git add -A` commits and may
  // `git checkout -b`, either of which would clobber the developer's work.
  await ensureNotPrimaryWorkTree(workingDirectory, 'create a commit');
  // A merge left unresolved by an earlier pre-pr-base-sync failure (task 691)
  // would otherwise fail `git add` with git's "you need to resolve your
  // current index first" — self-heal before staging.
  await recoverFromUnresolvedMerge(workingDirectory);

  const { stdout: currentBranch } = await execFileAsync('git', ['branch', '--show-current'], {
    cwd: workingDirectory,
    encoding: 'utf8',
    timeout: GIT_OP_TIMEOUT_MS,
  });
  const branch = currentBranch.trim();

  if (branch === 'main' || branch === 'master' || branch === 'develop') {
    const featureBranch = `feature/auto-${Date.now()}`;
    await execFileAsync('git', ['checkout', '-b', featureBranch], {
      cwd: workingDirectory,
      timeout: GIT_OP_TIMEOUT_MS,
    });
  }

  await removeTransientWorkflowFiles(workingDirectory);
  await execFileAsync('git', ['add', '-A'], {
    cwd: workingDirectory,
    timeout: GIT_OP_TIMEOUT_MS,
  });

  const { stdout: diffStat } = await execFileAsync('git', ['diff', '--cached', '--numstat'], {
    cwd: workingDirectory,
    encoding: 'utf8',
    timeout: GIT_OP_TIMEOUT_MS,
  });

  let filesChanged = 0;
  let additions = 0;
  let deletions = 0;

  diffStat
    .split('\n')
    .filter(Boolean)
    .forEach((line) => {
      const parts = line.split('\t');
      if (parts.length >= 2) {
        filesChanged++;
        additions += parseInt(parts[0]!, 10) || 0;
        deletions += parseInt(parts[1]!, 10) || 0;
      }
    });

  // Nothing staged means the implementer phase already committed its work in
  // this worktree. Running `git commit` here would exit non-zero ("nothing to
  // commit, working tree clean"), throw, and make the caller mark auto-commit
  // FAILED — which skips PR creation entirely (it's gated on auto-commit
  // success). That stranded branches full of real, already-committed changes
  // with no PR. Treat the empty case as a no-op SUCCESS on the current HEAD so
  // the caller still opens a PR from the commits already on the branch.
  if (filesChanged === 0) {
    const { stdout: existingHash } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: workingDirectory,
      encoding: 'utf8',
      timeout: GIT_OP_TIMEOUT_MS,
    });
    const { stdout: existingBranch } = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: workingDirectory,
      encoding: 'utf8',
      timeout: GIT_OP_TIMEOUT_MS,
    });
    // Report what the BRANCH contains, not what this no-op staged. Returning
    // zeros here is true of the auto-commit step but reads downstream as "this
    // task changed nothing" — measured 2026-08-23, a 6-file / +996-line commit
    // was logged as `filesChanged:0 +0/-0`, which is exactly backwards for
    // judging whether the agent did any work.
    const branchStat = await statBranchAgainstBase(workingDirectory, preferredBaseBranch);
    return {
      hash: existingHash.trim(),
      branch: existingBranch.trim(),
      ...branchStat,
      alreadyCommitted: true,
    };
  }

  const fullMessage = `${message}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`;
  await execFileAsync('git', ['commit', '-m', fullMessage], {
    cwd: workingDirectory,
    encoding: 'utf8',
    timeout: GIT_OP_TIMEOUT_MS,
  });

  const { stdout: hash } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: workingDirectory,
    encoding: 'utf8',
    timeout: GIT_OP_TIMEOUT_MS,
  });
  const { stdout: finalBranch } = await execFileAsync('git', ['branch', '--show-current'], {
    cwd: workingDirectory,
    encoding: 'utf8',
    timeout: GIT_OP_TIMEOUT_MS,
  });

  return {
    hash: hash.trim(),
    branch: finalBranch.trim(),
    filesChanged,
    additions,
    deletions,
    alreadyCommitted: false,
  };
}

/**
 * Diffstat of everything the current branch introduced since it forked.
 *
 * Used when the auto-commit stages nothing because the agent already committed
 * its work: the branch total is the honest answer to "did this task change
 * code?". Best-effort — an unresolvable fork point yields zeros rather than
 * failing the commit step.
 *
 * @param cwd - Worktree directory. / ワークツリー
 * @param preferredBaseBranch - Branch the worktree was cut from, when known. / 分岐元ブランチ
 * @returns Files / additions / deletions across the branch. / ブランチ全体の差分統計
 */
async function statBranchAgainstBase(
  cwd: string,
  preferredBaseBranch?: string | null,
): Promise<{ filesChanged: number; additions: number; deletions: number }> {
  const empty = { filesChanged: 0, additions: 0, deletions: 0 };
  try {
    const { resolveBaseRef } = await import('./diff-structured');
    const base = await resolveBaseRef(cwd, preferredBaseBranch);
    if (!base) return empty;
    const { stdout } = await execFileAsync('git', ['diff', '--numstat', `${base}..HEAD`], {
      cwd,
      encoding: 'utf8',
      timeout: GIT_OP_TIMEOUT_MS,
    });
    let filesChanged = 0;
    let additions = 0;
    let deletions = 0;
    for (const line of stdout.split('\n')) {
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      filesChanged++;
      additions += parseInt(parts[0]!, 10) || 0;
      deletions += parseInt(parts[1]!, 10) || 0;
    }
    return { filesChanged, additions, deletions };
  } catch {
    return empty;
  }
}
