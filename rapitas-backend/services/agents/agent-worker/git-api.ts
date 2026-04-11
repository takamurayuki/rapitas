/**
 * Agent Worker Git API
 *
 * Git operation methods delegated to the worker via IPC.
 * Covers commit, branch, worktree, diff, and PR operations.
 * Not responsible for execution lifecycle, IPC protocol, or event bridging.
 */

import type { IpcSender } from './public-api';

/**
 * Create or checkout a branch in the working directory via the worker.
 *
 * @param ipc - IPC sender / IPC送信関数
 * @param workingDirectory - Git repository path / gitリポジトリパス
 * @param branchName - Branch to create or checkout / ブランチ名
 * @returns true on success / 成功時true
 */
export async function createBranch(
  ipc: IpcSender,
  workingDirectory: string,
  branchName: string,
): Promise<boolean> {
  return ipc('create-branch', { workingDirectory, branchName }, 30000) as Promise<boolean>;
}

/**
 * Create a git worktree for isolated task execution.
 *
 * @param ipc - IPC sender / IPC送信関数
 * @param baseDir - Main repository root / メインリポジトリルート
 * @param branchName - Branch to create / 作成するブランチ名
 * @param taskId - Task ID for directory naming / ディレクトリ名用タスクID
 * @param repositoryUrl - Expected remote URL for validation / 検証用リモートURL
 * @returns Absolute path to the created worktree / worktreeの絶対パス
 */
export async function createWorktree(
  ipc: IpcSender,
  baseDir: string,
  branchName: string,
  taskId?: number,
  repositoryUrl?: string | null,
): Promise<string> {
  return ipc(
    'create-worktree',
    { baseDir, branchName, taskId, repositoryUrl },
    30000,
  ) as Promise<string>;
}

/**
 * Remove a git worktree.
 *
 * @param ipc - IPC sender / IPC送信関数
 * @param baseDir - Main repository root / メインリポジトリルート
 * @param worktreePath - Worktree path to remove / 削除するworktreeパス
 */
export async function removeWorktree(
  ipc: IpcSender,
  baseDir: string,
  worktreePath: string,
): Promise<void> {
  await ipc('remove-worktree', { baseDir, worktreePath }, 30000);
}

/**
 * Clean up stale worktrees from previous crashes.
 *
 * @param ipc - IPC sender / IPC送信関数
 * @param baseDir - Main repository root / メインリポジトリルート
 * @returns Count of cleaned worktrees / クリーンアップ数
 */
export async function cleanupStaleWorktrees(ipc: IpcSender, baseDir: string): Promise<number> {
  return ipc('cleanup-stale-worktrees', { baseDir }, 30000) as Promise<number>;
}

/**
 * Create a commit in the working directory.
 *
 * @param ipc - IPC sender / IPC送信関数
 * @param workingDirectory - Git repository path / gitリポジトリパス
 * @param message - Commit message / コミットメッセージ
 * @returns Commit metadata / コミットメタデータ
 */
export async function createCommit(
  ipc: IpcSender,
  workingDirectory: string,
  message: string,
): Promise<{
  hash: string;
  branch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
}> {
  return ipc('create-commit', { workingDirectory, message }, 30000) as Promise<{
    hash: string;
    branch: string;
    filesChanged: number;
    additions: number;
    deletions: number;
  }>;
}

/**
 * Create a pull request from the working directory.
 *
 * @param ipc - IPC sender / IPC送信関数
 * @param workingDirectory - Git repository path / gitリポジトリパス
 * @param title - PR title / PRタイトル
 * @param body - PR body / PR本文
 * @param baseBranch - Target branch / マージ先ブランチ
 * @returns PR creation result / PR作成結果
 */
export async function createPullRequest(
  ipc: IpcSender,
  workingDirectory: string,
  title: string,
  body: string,
  baseBranch: string = 'main',
): Promise<{ success: boolean; prUrl?: string; prNumber?: number; error?: string }> {
  return ipc(
    'create-pull-request',
    { workingDirectory, title, body, baseBranch },
    60000,
  ) as Promise<{
    success: boolean;
    prUrl?: string;
    prNumber?: number;
    error?: string;
  }>;
}

/**
 * Merge a pull request.
 *
 * @param ipc - IPC sender / IPC送信関数
 * @param workingDirectory - Git repository path / gitリポジトリパス
 * @param prNumber - PR number / PR番号
 * @param commitThreshold - Commit count threshold for squash vs merge / スカッシュ判定しきい値
 * @param baseBranch - Target branch / マージ先ブランチ
 * @returns Merge result / マージ結果
 */
export async function mergePullRequest(
  ipc: IpcSender,
  workingDirectory: string,
  prNumber: number,
  commitThreshold: number = 5,
  baseBranch: string = 'master',
): Promise<{ success: boolean; mergeStrategy?: 'squash' | 'merge'; error?: string }> {
  return ipc(
    'merge-pull-request',
    { workingDirectory, prNumber, commitThreshold, baseBranch },
    60000,
  ) as Promise<{
    success: boolean;
    mergeStrategy?: 'squash' | 'merge';
    error?: string;
  }>;
}

/**
 * Get the full git diff as a string.
 *
 * @param ipc - IPC sender / IPC送信関数
 * @param workingDirectory - Git repository path / gitリポジトリパス
 * @returns Diff string / diff文字列
 */
export async function getGitDiff(ipc: IpcSender, workingDirectory: string): Promise<string> {
  return ipc('get-git-diff', { workingDirectory }, 10000) as Promise<string>;
}

/**
 * Get the full git diff (alias).
 *
 * @param ipc - IPC sender / IPC送信関数
 * @param workingDirectory - Git repository path / gitリポジトリパス
 * @returns Diff string / diff文字列
 */
export async function getFullGitDiff(ipc: IpcSender, workingDirectory: string): Promise<string> {
  return ipc('get-full-git-diff', { workingDirectory }, 10000) as Promise<string>;
}

/**
 * Get structured diff (array of file change objects).
 *
 * @param ipc - IPC sender / IPC送信関数
 * @param workingDirectory - Git repository path / gitリポジトリパス
 * @returns Array of file diffs / ファイル差分リスト
 */
export async function getDiff(
  ipc: IpcSender,
  workingDirectory: string,
): Promise<
  Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>
> {
  return ipc('get-diff', { workingDirectory }, 10000) as Promise<
    Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string;
    }>
  >;
}

/**
 * Revert all uncommitted changes in the working directory.
 *
 * @param ipc - IPC sender / IPC送信関数
 * @param workingDirectory - Git repository path / gitリポジトリパス
 * @returns true on success / 成功時true
 */
export async function revertChanges(ipc: IpcSender, workingDirectory: string): Promise<boolean> {
  return ipc('revert-changes', { workingDirectory }, 10000) as Promise<boolean>;
}

/**
 * Commit staged changes (legacy helper, not the same as createCommit).
 *
 * @param ipc - IPC sender / IPC送信関数
 * @param workingDirectory - Git repository path / gitリポジトリパス
 * @param message - Commit message / コミットメッセージ
 * @param taskTitle - Optional task title for context / タスクタイトル
 * @returns Result with optional commitHash / コミット結果
 */
export async function commitChanges(
  ipc: IpcSender,
  workingDirectory: string,
  message: string,
  taskTitle?: string,
): Promise<{ success: boolean; commitHash?: string; error?: string }> {
  return ipc('commit-changes', { workingDirectory, message, taskTitle }, 30000) as Promise<{
    success: boolean;
    commitHash?: string;
    error?: string;
  }>;
}
