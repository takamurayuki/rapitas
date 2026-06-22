/**
 * Task Resolver
 *
 * Single source of truth for resolving a task's working directory, theme context,
 * and workflow state from the database. Not responsible for HTTP handling,
 * file I/O, or workflow mutations.
 */
import { prisma } from '../../config/database';

/** Resolved working-directory context for a task, including its parent theme id. / タスクの作業ディレクトリとテーマIDを含むコンテキスト */
export interface TaskContext {
  /** Resolved absolute path (task.workingDirectory ?? theme.workingDirectory), or null. / 解決済み作業ディレクトリパス */
  workingDirectory: string | null;
  /** Theme the task belongs to, or null when unset. / タスクが属するテーマID */
  themeId: number | null;
}

/** Resolved workflow-status context for a task. / タスクのワークフロー状態コンテキスト */
export interface TaskWorkflowContext {
  /** Current workflow status string, or null when unset. / 現在のワークフローステータス */
  workflowStatus: string | null;
  /** Workflow mode string, or null when unset. / ワークフローモード */
  workflowMode: string | null;
}

/**
 * Resolve the effective working directory for a task.
 * Falls back to the task's theme working directory when the task itself has none.
 * Returns null when neither the task nor its theme has a working directory,
 * or when the task does not exist or a DB error occurs.
 *
 * @param taskId - The task id to resolve. / 解決するタスクID
 * @returns Resolved working directory path, or null. / 解決済み作業ディレクトリパス、無ければnull
 */
export async function resolveTaskWorkingDirectory(taskId: number): Promise<string | null> {
  const task = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: {
        workingDirectory: true,
        theme: { select: { workingDirectory: true } },
      },
    })
    .catch(() => null);
  return task?.workingDirectory ?? task?.theme?.workingDirectory ?? null;
}

/**
 * Resolve the working directory and theme id for a task.
 * Falls back to the task's theme working directory when the task itself has none.
 * Returns `{ workingDirectory: null, themeId: null }` when the task does not exist
 * or a DB error occurs — callers should treat this as "context unavailable".
 *
 * @param taskId - The task id to resolve. / 解決するタスクID
 * @returns Resolved context object. / 解決されたコンテキストオブジェクト
 */
export async function resolveTaskContext(taskId: number): Promise<TaskContext> {
  const task = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: {
        workingDirectory: true,
        themeId: true,
        theme: { select: { workingDirectory: true } },
      },
    })
    .catch(() => null);
  return {
    workingDirectory: task?.workingDirectory ?? task?.theme?.workingDirectory ?? null,
    themeId: task?.themeId ?? null,
  };
}

/**
 * Resolve the workflow status and mode for a task.
 * Returns null when the task does not exist or a DB error occurs.
 *
 * @param taskId - The task id to resolve. / 解決するタスクID
 * @returns Workflow status and mode, or null. / ワークフロー状態とモード、無ければnull
 */
export async function resolveTaskWorkflowContext(
  taskId: number,
): Promise<TaskWorkflowContext | null> {
  const task = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: { workflowStatus: true, workflowMode: true },
    })
    .catch(() => null);
  if (!task) return null;
  return {
    workflowStatus: task.workflowStatus,
    workflowMode: task.workflowMode,
  };
}
