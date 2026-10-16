/**
 * Workflow Single-File Read Handler
 *
 * Serves GET /tasks/:taskId/files/:fileType — one workflow artifact at the same
 * URL its PUT counterpart writes to.
 * Not responsible for writing artifacts, status transitions, or the gates that
 * run on save (those live in workflow-handlers-files.ts and ./file-save/).
 */

import { NotFoundError, parseId } from '../../../middleware/error-handler';
import { resolveWorkflowDir, getFileInfo } from '../core/workflow-helpers';
import { validateFileType } from './file-save';

/**
 * Handler for GET /tasks/:taskId/files/:fileType
 * Returns one workflow artifact, mirroring the PUT route's URL shape.
 *
 * NOTE: A task that exists but has no artifact of this type answers 200 with
 * `exists: false`, NOT 404. This route exists because its absence was read as
 * the artifact's absence: task 1168's research row was written at 07:33 on
 * 2026-10-09, yet every verify round from 08:06 recorded
 * "GET /workflow/tasks/1168/files/research が HTTP 404" as an unmet acceptance
 * criterion — three verify_repair bounces, an iteration_budget_halted, and a
 * follow-up task filed on that false premise. Answering 404 for a missing
 * artifact would rebuild the same ambiguity, so only a missing TASK is a 404.
 *
 * @param params - Route params with taskId and fileType / ルートパラメータ
 * @returns The artifact's metadata and content, or `{ type, exists: false }` / アーティファクトの内容、または不在
 * @throws {NotFoundError} When the task does not exist / タスクが存在しない場合
 * @throws {ValidationError} When taskId or fileType is invalid / ID・種別が不正な場合
 */
export async function handleGetFile({ params }: { params: { taskId: string; fileType: string } }) {
  // Validated before the task lookup so a typo'd type never costs a query.
  const fileType = validateFileType(params.fileType);
  const taskId = parseId(params.taskId, 'task ID');

  const resolved = await resolveWorkflowDir(taskId);
  if (!resolved) {
    throw new NotFoundError('Task not found');
  }

  return getFileInfo(taskId, fileType);
}
