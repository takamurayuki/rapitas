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
