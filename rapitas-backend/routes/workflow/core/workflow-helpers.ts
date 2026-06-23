/**
 * Workflow Helpers
 *
 * Shared constants, types, and utility functions used across workflow route handlers.
 * Not responsible for route definitions or business logic orchestration.
 */

import { readFile, stat } from 'fs/promises';
import { WORKFLOW_STATUSES, WORKFLOW_FILE_TYPES } from '../../../services/workflow/workflow-types';
import type { WorkflowFileType } from '../../../services/workflow/workflow-types';

// NOTE: Re-exported as backward-compatible aliases so existing consumers (handlers, tests)
// continue to import from this path without change. The SSOT is workflow-types.ts.
export type { WorkflowFileType };
export const VALID_WORKFLOW_STATUSES = WORKFLOW_STATUSES;
export const VALID_FILE_TYPES = WORKFLOW_FILE_TYPES;

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
