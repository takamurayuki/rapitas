/**
 * Workflow Helpers
 *
 * Shared constants, types, and utility functions used across workflow route handlers.
 * Not responsible for route definitions or business logic orchestration.
 */

import { prisma } from '../../../config';
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
 * Get metadata and content for a single workflow file (DB-backed — see
 * WorkflowFile in prisma/schema/workflow.prisma).
 *
 * @param taskId - Task the artifact belongs to. / 対象タスクID
 * @param fileType - The workflow file type label / ファイル種別
 * @returns File info object including existence, content, and timestamps
 */
export async function getFileInfo(taskId: number, fileType: WorkflowFileType) {
  const row = await prisma.workflowFile
    .findUnique({
      where: { taskId_fileType: { taskId, fileType } },
      select: { content: true, sizeBytes: true, updatedAt: true },
    })
    .catch(() => null);
  if (!row) {
    return { type: fileType, exists: false };
  }
  return {
    type: fileType,
    exists: true,
    content: row.content,
    lastModified: row.updatedAt.toISOString(),
    size: row.sizeBytes,
  };
}
