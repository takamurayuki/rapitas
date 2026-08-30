/**
 * CommitCwd
 *
 * Resolves the directory the auto-commit/PR pipeline runs git in: the
 * execution config's explicit cwd, else the task's dedicated worktree, else
 * the theme's working directory. Owns only that resolution; the primary-tree
 * refusal stays with the git-operations worktree guard.
 *
 * Why the middle step exists: task 774 (2026-08-30) lost its
 * AgentExecutionConfig rows to a stale-execution recovery, the old fallback
 * went straight to the theme dir (= the PRIMARY checkout), and the guard
 * rightly refused to commit — completed work sat stranded in
 * `.worktrees/task-774-*` while the task blocked on verify_pr_not_created.
 */
import { readdir } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:workflow:commit-cwd');

/** Injectable directory listing for tests. */
export type ListDir = (dir: string) => Promise<string[]>;

const defaultListDir: ListDir = async (dir) =>
  (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);

/**
 * The task's dedicated worktree under `<themeDir>/.worktrees/task-<id>-*`,
 * or null when none exists (manual tasks, cleaned-up worktrees, fs errors).
 *
 * @param themeDir - Theme working directory (worktree parent). / テーマ作業ディレクトリ
 * @param taskId - Task whose worktree to find. / 対象タスクID
 * @param listDir - Directory lister override for tests. / テスト用差し替え
 * @returns Absolute worktree path or null. / worktree パス（無ければ null）
 */
export async function findTaskWorktreeDir(
  themeDir: string | null | undefined,
  taskId: number,
  listDir: ListDir = defaultListDir,
): Promise<string | null> {
  if (!themeDir) return null;
  try {
    const entries = await listDir(join(themeDir, '.worktrees'));
    const prefix = `task-${taskId}-`;
    const hit = entries.find((name) => name.startsWith(prefix));
    return hit ? join(themeDir, '.worktrees', hit) : null;
  } catch {
    return null;
  }
}

/**
 * The cwd auto-commit should use: explicit config dir → task worktree → theme dir.
 *
 * @param execConfig - Execution config carrying the explicit cwd. / 実行設定
 * @param task - Task with its theme's working directory. / テーマ付きタスク
 * @param taskId - Task id for the worktree lookup. / タスクID
 * @param listDir - Directory lister override for tests. / テスト用差し替え
 * @returns The resolved cwd, or undefined when nothing is configured. / 解決済み cwd
 */
export async function resolveCommitCwd(
  execConfig: { workingDirectory?: string | null } | null | undefined,
  task: { theme?: { workingDirectory?: string | null } | null } | null | undefined,
  taskId: number,
  listDir: ListDir = defaultListDir,
): Promise<string | undefined> {
  const explicitDir = execConfig?.workingDirectory;
  const themeDir = task?.theme?.workingDirectory;
  if (explicitDir) return explicitDir;
  const worktree = await findTaskWorktreeDir(themeDir, taskId, listDir);
  if (worktree) {
    log.info(
      { taskId, worktree },
      '[commit-cwd] Execution config missing — using the task worktree instead of the theme dir',
    );
    return worktree;
  }
  return themeDir ?? undefined;
}
