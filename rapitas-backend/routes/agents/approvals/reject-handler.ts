/**
 * Approvals — RejectHandler
 *
 * Handles POST /approvals/:id/reject. Marks the request rejected; for a legacy
 * code_review request it also reverts the working-directory changes.
 * (The code-review approve/diff flow and request-changes re-execution were
 * removed — a completed task's PR is opened directly instead.)
 */

import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { NotFoundError, ValidationError, parseId } from '../../../middleware/error-handler';
import { orchestrator } from '../../../services/core/orchestrator-instance';
import { fromJsonString } from '../../../utils/database/db-helpers';

export const rejectRoutes = new Elysia()
  // Reject request
  .post(
    '/:id/reject',
    async (context) => {
      const params = context.params as { id: string };
      const body = context.body as { reason?: string };
      const { id } = params;
      const { reason } = body;

      const rejectionApprovalId = parseId(id, 'approval ID');
      const approval = await prisma.approvalRequest.findUnique({
        where: { id: rejectionApprovalId },
        include: {
          config: {
            include: { task: true },
          },
        },
      });

      if (!approval) {
        throw new NotFoundError('Approval request not found');
      }

      await prisma.approvalRequest.update({
        where: { id: rejectionApprovalId },
        data: {
          status: 'rejected',
          rejectedAt: new Date(),
          rejectionReason: reason,
        },
      });

      if (approval.requestType === 'code_review') {
        const proposedChanges = fromJsonString<{
          workingDirectory: string;
        }>(approval.proposedChanges);

        if (!proposedChanges) {
          throw new ValidationError('Invalid proposed changes data');
        }

        const reverted = await orchestrator.revertChanges(proposedChanges.workingDirectory);

        await prisma.notification.create({
          data: {
            type: 'pr_changes_requested',
            title: 'コードレビュー却下',
            message: `「${approval.config.task.title}」のコードレビューが却下されました${reason ? `: ${reason}` : ''}。変更は元に戻されました。`,
            link: `/tasks/${approval.config.taskId}`,
          },
        });

        return { success: true, reverted };
      }

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Optional(
        t.Object(
          { reason: t.Optional(t.String({ maxLength: 2000 })) },
          { additionalProperties: false },
        ),
      ),
    },
  );
