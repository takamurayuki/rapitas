/**
 * Workflow Status Handler
 *
 * Route handler for manual workflow-status changes by a human (ui) or an
 * operator. Not responsible for the queue/scheduler follow-up, which lives in
 * services/workflow/manual-status.
 */

import { prisma } from '../../../../config';
import { NotFoundError, ValidationError, parseId } from '../../../../middleware/error-handler';
import { createLogger } from '../../../../config/logger';
import { VALID_WORKFLOW_STATUSES } from '../../core/workflow-helpers';
import { isWorkflowStatus } from '../../../../services/workflow/workflow-types.guards.generated';
import { recordTransition } from '../../../../services/workflow/transition-recorder';
import { previewMissingFilesForStatus } from '../../../../services/workflow/workflow-invariants';
import { resolveTaskWorkflowState } from '../../../../services/task/task-resolver';
import { HTTP_STATUS } from '../../../../utils/common/http-status';
import { humanSourceLabel } from '../../../../utils/common/human-source';

const log = createLogger('routes:workflow:handlers:status');

/** Callers permitted to change a status by hand; the value is recorded as `source`. */
const STATUS_CHANGE_SOURCES: Readonly<Record<string, 'ui' | 'operator'>> = {
  ui: 'ui',
  operator: 'operator',
};

/** Human-readable form of each source, recorded as `sourceLabel`. */
const STATUS_CHANGE_SOURCE_LABELS = { ui: 'UI', operator: 'オペレーター' } as const;

/**
 * Handler for PUT /tasks/:taskId/status
 * Manually updates the workflow status of a task and re-syncs auto-run.
 *
 * @param params - Route params with taskId / ルートパラメータ
 * @param body - status, reason (required for operator) and force / リクエストボディ
 * @param headers - Request headers, checked for X-Rapitas-Source (ui|operator) / リクエストヘッダ
 * @param set - Elysia response set / Elysiaレスポンス
 * @returns Updated task, new workflow status and the queue sync outcome
 * @throws {ValidationError} When status is invalid, the source is not ui|operator,
 *   or an operator gives no reason / 状態・発行元・理由が不正な場合
 * @throws {NotFoundError} When task does not exist / タスクが無い場合
 */
export async function handleUpdateStatus({
  params,
  body,
  headers,
  set,
}: {
  params: { taskId: string };
  body: unknown;
  headers?: Record<string, string | undefined>;
  set: { status: number };
}) {
  try {
    const taskId = parseId(params.taskId, 'task ID');

    const parsedBody = body as { status: string; reason?: unknown; force?: boolean };
    if (!parsedBody?.status || !isWorkflowStatus(parsedBody.status)) {
      throw new ValidationError(
        `Invalid status. Must be one of: ${VALID_WORKFLOW_STATUSES.join(', ')}`,
      );
    }
    const targetStatus = parsedBody.status;

    // Block agents from calling this endpoint to bypass the file-save guard.
    // Past incidents had implementer phase claude-code agents calling
    // `PUT /tasks/:id/status` to bump themselves from plan_approved → in_progress
    // so they could then save verify.md. Server-internal callers don't go
    // through HTTP at all, so legitimate traffic always names a human source.
    const rawSource = headers?.['x-rapitas-source'];
    const source = humanSourceLabel(rawSource, STATUS_CHANGE_SOURCES) as
      | 'ui'
      | 'operator'
      | undefined;
    if (!source) {
      log.warn(
        {
          taskId,
          attemptedStatus: targetStatus,
          source: rawSource ?? null,
          ua: headers?.['user-agent'] ?? null,
        },
        '[Workflow] Rejected manual status change: missing X-Rapitas-Source=ui|operator header (likely an agent shell-call)',
      );
      // Record the bypass attempt for forensics.
      await recordTransition({
        taskId,
        fromStatus: null,
        toStatus: targetStatus,
        actor: 'system',
        cause: 'manual_status_change_blocked',
        metadata: {
          reason: 'missing X-Rapitas-Source=ui|operator header',
          source: rawSource ?? null,
          ua: headers?.['user-agent'] ?? null,
        },
        invariantViolation: true,
        invariantMessage:
          'Agent attempted to call PUT /tasks/:id/status without a ui|operator header',
      });
      throw new ValidationError(
        'Manual workflow-status changes require the X-Rapitas-Source=ui|operator header. ' +
          'Agents are not permitted to mutate workflow state directly.',
      );
    }

    const reason = typeof parsedBody.reason === 'string' ? parsedBody.reason.trim() || null : null;
    // The screen enforces a reason itself; an operator call has no form to do so.
    if (source === 'operator' && !reason) {
      throw new ValidationError(
        'reason (non-empty string) is required for operator status changes',
      );
    }
    // NOTE: actor stays 'user' for both sources — userActedAfter and
    // healBlockedStatusDesync only recognise a human revival through it.
    const metadata = { reason, source, sourceLabel: STATUS_CHANGE_SOURCE_LABELS[source] };

    const task = await resolveTaskWorkflowState(taskId);
    if (!task) throw new NotFoundError('Task not found');

    // Pre-check: verify required files exist for the target status. Advancing to a
    // status whose required files are absent is the primary root cause of invariant
    // violations detected in the subsequent file-save step. Soft-block when files
    // are missing unless the caller explicitly sets force=true (for intentional
    // resets and special operational use cases).
    const missingFiles = await previewMissingFilesForStatus(taskId, targetStatus);
    if (missingFiles.length > 0) {
      if (!parsedBody.force) {
        set.status = HTTP_STATUS.UNPROCESSABLE_ENTITY;
        return {
          error: `ステータス "${targetStatus}" への変更を拒否しました: 必要なファイルがディスクに存在しません。`,
          missingFiles,
          hint: `不足ファイルを先に保存してください (PUT /workflow/tasks/${taskId}/files/<type>)、またはステータスを draft にリセットしてください。強制的に変更する場合は body に force: true を追加してください。`,
        };
      }
      // force=true: apply but record the invariant violation for tracking.
      log.warn(
        { taskId, targetStatus, missingFiles },
        '[Workflow] Manual status set with force=true despite missing files',
      );
      await recordTransition({
        taskId,
        fromStatus: task.workflowStatus ?? null,
        toStatus: targetStatus,
        actor: 'user',
        cause: 'manual_status_change',
        metadata: { ...metadata, force: true, missingFiles },
        invariantViolation: true,
        invariantMessage: `manual status set with missing files (force): ${missingFiles.join(', ')}`,
      });
    } else {
      await recordTransition({
        taskId,
        fromStatus: task.workflowStatus ?? null,
        toStatus: targetStatus,
        actor: 'user',
        cause: 'manual_status_change',
        metadata,
      });
    }

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: { workflowStatus: targetStatus, updatedAt: new Date() },
    });

    await prisma.activityLog.create({
      data: {
        taskId,
        action: 'workflow_status_updated',
        metadata: JSON.stringify({
          previousStatus: task.workflowStatus,
          newStatus: targetStatus,
        }),
        createdAt: new Date(),
      },
    });

    // The status is already saved, so a sync failure is reported, not thrown.
    const queueSync = await import('../../../../services/workflow/manual-status')
      .then(({ syncQueueAfterManualStatusChange }) =>
        syncQueueAfterManualStatusChange(taskId, targetStatus),
      )
      .catch((err: unknown) => {
        log.warn({ err, taskId }, '[Workflow] Queue sync after manual status change failed');
        return { outcome: 'error' as const };
      });

    return { success: true, task: updatedTask, workflowStatus: targetStatus, queueSync };
  } catch (err) {
    if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
    log.error({ err }, 'Error updating workflow status');
    throw err;
  }
}
