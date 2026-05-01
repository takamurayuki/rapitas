/**
 * workflow-paths
 *
 * Single source of truth for where workflow Markdown files live on disk.
 * Historically these were stored under `rapitas-backend/tasks/...` inside
 * the source repository, polluting `git status` and the IDE's file index.
 * They now live under the user's data dir (`~/.rapitas/workflows/...`)
 * unless overridden by `RAPITAS_DATA_DIR`.
 *
 * Layout:
 *   <baseDir>/<categoryId>/<themeId>/<taskId>/{research|plan|question|verify}.md
 *   <baseDir>/<categoryId>/<themeId>/<taskId>/_archive/<isoTimestamp>/<file>.md
 *
 * The legacy path is still understood at read time via `resolveLegacyTaskDir`,
 * which `migrateLegacyWorkflowFiles` uses on startup to move old data to the
 * new location.
 */
import { homedir } from 'os';
import { join } from 'path';

/**
 * Absolute path of the workflow base directory for the current process.
 *
 * @returns Base directory containing all task workflow folders. / ベースディレクトリ
 */
export function getWorkflowBaseDir(): string {
  const override = process.env.RAPITAS_DATA_DIR;
  if (override && override.trim().length > 0) {
    return join(override, 'workflows');
  }
  return join(homedir(), '.rapitas', 'workflows');
}

/**
 * Resolve the per-task workflow directory using the `<category>/<theme>/<task>`
 * convention. Both ids fall back to `0` when null so unsorted tasks still
 * land somewhere predictable.
 *
 * @param categoryId - Theme's parent category id, or null. / カテゴリID
 * @param themeId - Theme id, or null. / テーマID
 * @param taskId - Task id. / タスクID
 * @returns Absolute path. / 絶対パス
 */
export function getTaskWorkflowDir(
  categoryId: number | null,
  themeId: number | null,
  taskId: number,
): string {
  const cat = categoryId !== null ? String(categoryId) : '0';
  const theme = themeId !== null ? String(themeId) : '0';
  return join(getWorkflowBaseDir(), cat, theme, String(taskId));
}

/**
 * Path of the legacy in-repo workflow directory for a given task. Used by
 * the one-shot migration so we know where to copy from.
 *
 * @param categoryId - Same semantics as `getTaskWorkflowDir`. / カテゴリID
 * @param themeId - Same. / テーマID
 * @param taskId - Same. / タスクID
 * @returns Legacy absolute path. / 旧形式の絶対パス
 */
export function resolveLegacyTaskDir(
  categoryId: number | null,
  themeId: number | null,
  taskId: number,
): string {
  const cat = categoryId !== null ? String(categoryId) : '0';
  const theme = themeId !== null ? String(themeId) : '0';
  return join(process.cwd(), 'tasks', cat, theme, String(taskId));
}

/**
 * Archive subdirectory inside a task's workflow folder. Used by writers when
 * superseding an existing markdown so previous versions can be inspected.
 *
 * @param taskDir - Output of `getTaskWorkflowDir`. / 解決済みタスクディレクトリ
 * @param isoTimestamp - Timestamp suffix used as folder name. / タイムスタンプ
 */
export function getArchiveDir(taskDir: string, isoTimestamp: string): string {
  return join(taskDir, '_archive', isoTimestamp.replace(/[:.]/g, '-'));
}

/**
 * Absolute path of the agent-temp directory for transient capture files
 * (e.g. codex `--output-last-message` outputs that we read once and move
 * to the workflow API).
 *
 * Lives OUTSIDE any project worktree so:
 *   - The file survives worktree cleanup that runs before / during the
 *     post-handler harvest step.
 *   - It works for ANY working directory the agent operates in (rapitas,
 *     other projects, etc.) without polluting the project tree.
 *   - One canonical location operators can purge if it grows.
 *
 * Layout: `<baseDir>/agent-temp/<scope>/<filename>` where baseDir is
 *   `${RAPITAS_DATA_DIR}` or `${HOME}/.rapitas`.
 *
 * @returns Base directory for agent transient files. / agent一時ファイルベースディレクトリ
 */
export function getAgentTempBaseDir(): string {
  const override = process.env.RAPITAS_DATA_DIR;
  if (override && override.trim().length > 0) {
    return join(override, 'agent-temp');
  }
  return join(homedir(), '.rapitas', 'agent-temp');
}

/**
 * Resolve the per-task agent-temp directory used to capture CLI output
 * before it is uploaded to the workflow API. Independent of the worktree
 * so files survive `git worktree remove` / cleanup.
 *
 * @param taskId - Task id. / タスクID
 * @param sessionId - Session id (optional, when known). / セッションID（任意）
 * @returns Absolute directory path. / 絶対パス
 */
export function getAgentTempDir(taskId: number, sessionId?: number | null): string {
  const session = sessionId ? `s${sessionId}` : 'no-session';
  return join(getAgentTempBaseDir(), `task-${taskId}`, session);
}
