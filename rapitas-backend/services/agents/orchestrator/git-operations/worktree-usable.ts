/**
 * Worktree Usable
 *
 * Single source of truth for "is a recorded worktree path safe to reuse?" and
 * "what should a re-run do with it?". A recorded worktreePath is only reusable
 * when it still exists ON DISK — reusing a phantom path (removed by a
 * stop/cleanup or a merged-PR worktree teardown) makes the re-run spawn an
 * agent with a non-existent cwd, which fails "Working directory does not exist"
 * and retries until the task is blocked (task 30 / task 233 regressions).
 *
 * Pure and dependency-light (only `fs.existsSync`) so any execution entry point
 * — workflow orchestrator, continue-execution route, workers — can guard with
 * the same logic instead of re-implementing (and forgetting) the disk check.
 */
import { existsSync } from 'fs';
import { join } from 'path';

/** What a re-run should do with a recorded worktree path. */
export type WorktreeDecision = 'reuse' | 'recreate' | 'fallback';

/**
 * Whether a worktree recorded on a prior session can be REUSED for this run.
 *
 * Requires not just that the path EXISTS but that it is a REAL git worktree —
 * a linked worktree always has a `.git` entry (a file pointing back to the main
 * repo's `worktrees/<name>`). A bare existsSync was insufficient: a partially
 * created worktree (git worktree add failed after mkdir) leaves an EMPTY
 * directory that passes existsSync, so it was "reused"; the agent then ran in an
 * empty dir where git resolves to the PARENT (primary) checkout — silently
 * editing/clobbering the main checkout and losing the task's work (task 288).
 *
 * @param recordedPath - worktreePath from the latest prior session. / 直近セッションの worktreePath
 * @param pathExists - existence probe (injectable for tests). / 存在判定（テスト差し替え用）
 * @returns true when the worktree is safe to reuse. / 再利用可能なら true
 */
export function canReuseWorktree(
  recordedPath: string | null | undefined,
  pathExists: (p: string) => boolean = existsSync,
): boolean {
  return !!recordedPath && pathExists(recordedPath) && pathExists(join(recordedPath, '.git'));
}

/**
 * Decide how a re-run should obtain its working directory:
 *   - `reuse`    — the recorded worktree still exists on disk.
 *   - `recreate` — it is missing (or never recorded) but a branch is known, so
 *                  a fresh worktree can be created on that branch.
 *   - `fallback` — missing and no branch is known; the caller must fall back to
 *                  the project working directory.
 *
 * @param recordedPath - Recorded worktreePath (may be a phantom). / 記録された worktreePath
 * @param branchName - Branch to recreate the worktree on, if any. / 再生成に使うブランチ
 * @param pathExists - Existence probe (injectable for tests). / 存在判定
 * @returns The decision the caller should act on. / 呼び出し側が取るべき判断
 */
export function decideWorktree(
  recordedPath: string | null | undefined,
  branchName: string | null | undefined,
  pathExists: (p: string) => boolean = existsSync,
): WorktreeDecision {
  if (canReuseWorktree(recordedPath, pathExists)) return 'reuse';
  if (branchName) return 'recreate';
  return 'fallback';
}
