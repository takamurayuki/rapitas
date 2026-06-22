/**
 * Task Resolver
 *
 * Single source of truth for resolving a Task ID to a validated Task row with
 * its commonly-needed relations. Not responsible for HTTP handling, business
 * logic, or task mutations.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';

/** Task with its Theme (workingDirectory / name / defaultBranch etc.) */
export type TaskWithTheme = Prisma.TaskGetPayload<{
  select: {
    id: true;
    themeId: true;
    workflowStatus: true;
    theme: { select: { workingDirectory: true; name: true } };
  };
}>;

/** Task with Theme + Category — needed for workflow directory resolution. */
export type TaskWithThemeAndCategory = Prisma.TaskGetPayload<{
  include: { theme: { include: { category: true } } };
}>;

/** Task with DeveloperModeConfig + Theme — needed for agent execution launch. */
export type TaskForExecution = Prisma.TaskGetPayload<{
  include: { developerModeConfig: true; theme: true };
}>;

/** Minimal shape for resolving a task's effective working directory. */
export type TaskWorkingDirectory = Prisma.TaskGetPayload<{
  select: {
    themeId: true;
    workingDirectory: true;
    theme: { select: { workingDirectory: true } };
  };
}>;

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
 * Resolve a Task ID to its Theme-joined row (select-based, lightweight).
 * Returns null when the task is absent or a DB error occurs.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Task with theme select, or null. / テーマ付きタスク、なければnull
 */
export async function resolveTaskWithTheme(taskId: number): Promise<TaskWithTheme | null> {
  return prisma.task
    .findUnique({
      where: { id: taskId },
      select: {
        id: true,
        themeId: true,
        workflowStatus: true,
        theme: { select: { workingDirectory: true, name: true } },
      },
    })
    .catch(() => null);
}

/**
 * Resolve a Task ID to its full Theme + Category join.
 * Used for workflow directory resolution (category/theme IDs required).
 * Returns null when the task is absent or a DB error occurs.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Task with theme and category, or null. / テーマ・カテゴリ付きタスク、なければnull
 */
export async function resolveTaskWithThemeAndCategory(
  taskId: number,
): Promise<TaskWithThemeAndCategory | null> {
  return prisma.task
    .findUnique({
      where: { id: taskId },
      include: { theme: { include: { category: true } } },
    })
    .catch(() => null);
}

/**
 * Resolve a Task ID to the shape required for agent execution launch.
 * Includes DeveloperModeConfig and Theme relations.
 * Returns null when the task is absent or a DB error occurs.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Task with developerModeConfig and theme, or null. / 開発者モード設定・テーマ付きタスク、なければnull
 */
export async function resolveTaskForExecution(taskId: number): Promise<TaskForExecution | null> {
  return prisma.task
    .findUnique({
      where: { id: taskId },
      include: { developerModeConfig: true, theme: true },
    })
    .catch(() => null);
}

/**
 * Resolve a Task ID to the minimal shape needed for working-directory lookup.
 * Uses select (not include) to keep the query lightweight.
 * Returns null when the task is absent or a DB error occurs.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Minimal task with workingDirectory fields, or null. / 作業ディレクトリフィールドのみのタスク、なければnull
 */
export async function resolveTaskWorkingDirectory(
  taskId: number,
): Promise<TaskWorkingDirectory | null> {
  return prisma.task
    .findUnique({
      where: { id: taskId },
      select: {
        themeId: true,
        workingDirectory: true,
        theme: { select: { workingDirectory: true } },
      },
    })
    .catch(() => null);
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
