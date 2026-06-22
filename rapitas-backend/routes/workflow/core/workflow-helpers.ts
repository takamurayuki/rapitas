/**
 * Workflow Helpers
 *
 * Shared constants, types, and utility functions used across workflow route handlers.
 * Not responsible for route definitions or business logic orchestration.
 */

import { readFile, stat } from 'fs/promises';

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

// NOTE: Re-exported from services to avoid the duplicate implementation that previously lived here.
export { resolveWorkflowDir } from '../../../services/workflow/workflow-file-utils';

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
