/**
 * GitOperations — Core Operations
 *
 * Basic git diff, commit, and create-commit operations.
 * Structured per-file diff is in diff-structured.ts.
 * Not responsible for branch management, pull requests, or worktrees.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../../../config/logger';

export { getDiff } from './diff-structured';

const execAsync = promisify(exec);
const logger = createLogger('git-operations/core-ops');

/**
 * Get the unstaged git diff for a working directory.
 *
 * @param workingDirectory - Directory to diff / diffを取得するディレクトリ
 * @returns Diff string, or empty string on error / diff文字列、エラー時は空文字
 */
export async function getGitDiff(workingDirectory: string): Promise<string> {
  try {
    const { stdout } = await execAsync('git diff', {
      cwd: workingDirectory,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
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
    const { stdout: staged } = await execAsync('git diff --cached', {
      cwd: workingDirectory,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const { stdout: unstaged } = await execAsync('git diff', {
      cwd: workingDirectory,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const { stdout: untracked } = await execAsync('git ls-files --others --exclude-standard', {
      cwd: workingDirectory,
      encoding: 'utf8',
    });

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
    await execAsync('git add -A', { cwd: workingDirectory });

    const fullMessage = taskTitle
      ? `${message}\n\nTask: ${taskTitle}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`
      : `${message}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`;

    await execAsync(`git commit -m "${fullMessage.replace(/"/g, '\\"')}"`, {
      cwd: workingDirectory,
      encoding: 'utf8',
    });

    const { stdout: hash } = await execAsync('git rev-parse HEAD', {
      cwd: workingDirectory,
      encoding: 'utf8',
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
): Promise<{
  hash: string;
  branch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
}> {
  const { stdout: currentBranch } = await execAsync('git branch --show-current', {
    cwd: workingDirectory,
    encoding: 'utf8',
  });
  const branch = currentBranch.trim();

  if (branch === 'main' || branch === 'master' || branch === 'develop') {
    const featureBranch = `feature/auto-${Date.now()}`;
    await execAsync(`git checkout -b ${featureBranch}`, { cwd: workingDirectory });
  }

  await execAsync('git add -A', { cwd: workingDirectory });

  const { stdout: diffStat } = await execAsync('git diff --cached --numstat', {
    cwd: workingDirectory,
    encoding: 'utf8',
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

  const fullMessage = `${message}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`;
  await execAsync(`git commit -m "${fullMessage.replace(/"/g, '\\"')}"`, {
    cwd: workingDirectory,
    encoding: 'utf8',
  });

  const { stdout: hash } = await execAsync('git rev-parse HEAD', {
    cwd: workingDirectory,
    encoding: 'utf8',
  });
  const { stdout: finalBranch } = await execAsync('git branch --show-current', {
    cwd: workingDirectory,
    encoding: 'utf8',
  });

  return {
    hash: hash.trim(),
    branch: finalBranch.trim(),
    filesChanged,
    additions,
    deletions,
  };
}
