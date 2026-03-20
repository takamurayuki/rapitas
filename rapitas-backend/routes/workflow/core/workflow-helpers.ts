/**
 * Workflow Helpers
 *
 * Shared constants, types, and utility functions used across workflow route handlers.
 * Not responsible for route definitions or business logic orchestration.
 */

import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { prisma } from '../../../config';

export const VALID_FILE_TYPES = ['research', 'question', 'plan', 'verify'] as const;
export type WorkflowFileType = (typeof VALID_FILE_TYPES)[number];

export const VALID_WORKFLOW_STATUSES = [
  'draft',
  'research_done',
  'plan_created',
  'plan_approved',
  'in_progress',
  'verify_done',
  'completed',
] as const;

/**
 * Resolve the workflow directory path from a task ID.
 * Traverses Task -> Theme -> Category relations to get IDs.
 *
 * @param taskId - The task ID to resolve / タスクIDからディレクトリを解決する
 * @returns Resolved task, dir path, and related IDs, or null if not found
 */
export async function resolveWorkflowDir(taskId: number) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { theme: { include: { category: true } } },
  });

  if (!task) return null;

  const categoryId = task.theme?.categoryId ?? null;
  const themeId = task.themeId ?? null;

  const categoryDir = categoryId !== null ? String(categoryId) : '0';
  const themeDir = themeId !== null ? String(themeId) : '0';

  return {
    task,
    dir: join(process.cwd(), 'tasks', categoryDir, themeDir, String(taskId)),
    categoryId,
    themeId,
  };
}

/**
 * Get metadata and content for a single workflow file.
 *
 * @param filePath - Absolute path to the markdown file / ファイルパス
 * @param fileType - The workflow file type label / ファイル種別
 * @returns File info object including existence, content, and timestamps
 */
export async function getFileInfo(filePath: string, fileType: WorkflowFileType) {
  try {
    const content = await readFile(filePath, 'utf-8');
    const stats = await stat(filePath);
    return {
      type: fileType,
      exists: true,
      content,
      lastModified: stats.mtime.toISOString(),
      size: stats.size,
    };
  } catch {
    return {
      type: fileType,
      exists: false,
    };
  }
}
