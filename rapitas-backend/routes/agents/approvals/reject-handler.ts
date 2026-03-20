/**
 * Approvals — RejectHandler
 *
 * Handles POST /approvals/:id/reject and POST /approvals/:id/request-changes.
 * Reverts git changes and optionally triggers re-execution with feedback.
 * Not responsible for approval, code-review-specific commit/PR flows, or diff retrieval.
 */

import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { NotFoundError, ValidationError, parseId } from '../../../middleware/error-handler';
import { orchestrator } from '../../../services/orchestrator-instance';
import { toJsonString, fromJsonString } from '../../../utils/db-helpers';
import {
  captureScreenshotsForDiff,
  type ScreenshotResult,
} from '../../../services/screenshot-service';

const log = createLogger('routes:approvals:reject');

export const rejectRoutes = new Elysia()
  // Reject request
  .post('/:id/reject', async (context) => {
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
  })

  // Request changes (revert + re-execute with feedback)
  .post('/:id/request-changes', async (context) => {
    const params = context.params as { id: string };
    const body = context.body as {
      feedback: string;
      comments: { file?: string; content: string; type: string }[];
    };
    const requestChangesId = parseId(params.id, 'approval ID');
    const { feedback, comments } = body;

    const approval = await prisma.approvalRequest.findUnique({
      where: { id: requestChangesId },
      include: {
        config: {
          include: { task: { include: { theme: true } } },
        },
      },
    });

    if (!approval) {
      throw new NotFoundError('Approval request not found');
    }

    if (approval.requestType !== 'code_review') {
      throw new ValidationError('This endpoint is only for code_review requests');
    }

    const proposedChanges = fromJsonString<{
      workingDirectory?: string;
      sessionId?: number;
      implementationSummary?: string;
    }>(approval.proposedChanges);

    const workingDirectory =
      proposedChanges?.workingDirectory || approval.config.task?.theme?.workingDirectory;

    if (!workingDirectory) {
      throw new NotFoundError('Working directory not found');
    }

    const task = approval.config.task;
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    try {
      await orchestrator.revertChanges(workingDirectory);

      const feedbackInstructions = [];

      if (feedback) {
        feedbackInstructions.push(`## Overall Feedback\n${feedback}`);
      }

      if (comments && comments.length > 0) {
        feedbackInstructions.push('\n## Specific Change Requests:');
        comments.forEach((comment, index) => {
          const typeLabel =
            comment.type === 'change_request'
              ? 'Fix'
              : comment.type === 'question'
                ? 'Question'
                : 'Comment';
          const fileInfo = comment.file ? ` (${comment.file})` : '';
          feedbackInstructions.push(`${index + 1}. [${typeLabel}]${fileInfo}: ${comment.content}`);
        });
      }

      const additionalInstructions = feedbackInstructions.join('\n');

      const previousImplementation = proposedChanges?.implementationSummary
        ? `\n\n## Previous Implementation (Reference):\n${proposedChanges.implementationSummary.substring(0, 1000)}`
        : '';

      const fullInstruction = `
Please implement the following task. There is feedback on the previous implementation, so please fix and improve based on that feedback.

## Task
${task.title}
${task.description || ''}

${additionalInstructions}
${previousImplementation}

Please implement the changes reflecting the above feedback.
`;

      await prisma.approvalRequest.update({
        where: { id: requestChangesId },
        data: {
          status: 'rejected',
          rejectedAt: new Date(),
          rejectionReason:
            '修正依頼: ' +
            (feedback || comments.map((c) => c.content).join(', ')).substring(0, 200),
        },
      });

      const session = await prisma.agentSession.create({
        data: {
          configId: approval.configId,
          status: 'pending',
          metadata: toJsonString({
            previousApprovalId: requestChangesId,
            feedbackIteration: true,
          }),
        },
      });

      const agentConfig = await prisma.aIAgentConfig.findFirst({
        where: { isDefault: true, isActive: true },
      });

      const timeout = 900000; // 15 minutes

      orchestrator
        .executeTask(
          {
            id: task.id,
            title: task.title,
            description: fullInstruction,
            context: task.executionInstructions || undefined,
            workingDirectory,
          },
          {
            taskId: task.id,
            sessionId: session.id,
            agentConfigId: agentConfig?.id,
            workingDirectory,
            timeout,
          },
        )
        .then(async (result) => {
          if (result.success) {
            const diff = await orchestrator.getFullGitDiff(workingDirectory);
            const structuredDiff = await orchestrator.getDiff(workingDirectory);

            if (diff && diff !== 'No changes detected') {
              const implementationSummary = result.output || '修正が完了しました。';

              let screenshots: ScreenshotResult[] = [];
              try {
                screenshots = await captureScreenshotsForDiff(structuredDiff, {
                  workingDirectory,
                  agentOutput: result.output || '',
                });
                if (screenshots.length > 0) {
                  log.info(
                    `[approvals] Captured ${screenshots.length} screenshots for task ${task.id}: ${screenshots.map((s) => s.page).join(', ')}`,
                  );
                }
              } catch (screenshotErr) {
                log.warn(
                  { err: screenshotErr },
                  '[approvals] Screenshot capture failed (non-fatal)',
                );
              }

              // Strip filesystem paths before storing — only keep front-end-safe data
              const screenshotData = screenshots.map(({ path, ...rest }) => rest);
              const newApprovalRequest = await prisma.approvalRequest.create({
                data: {
                  configId: approval.configId,
                  requestType: 'code_review',
                  title: `「${task.title}」のコードレビュー（修正版）`,
                  description: implementationSummary,
                  proposedChanges:
                    toJsonString({
                      taskId: task.id,
                      sessionId: session.id,
                      workingDirectory,
                      structuredDiff,
                      implementationSummary,
                      executionTimeMs: result.executionTimeMs,
                      feedbackIteration: true,
                      previousFeedback: feedback,
                      previousComments: comments,
                      screenshots: screenshotData,
                    }) ?? '',
                  estimatedChanges: toJsonString({
                    filesChanged: structuredDiff.length,
                    summary: implementationSummary.substring(0, 500),
                  }),
                  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                },
              });

              await prisma.notification.create({
                data: {
                  type: 'pr_review_requested',
                  title: '修正版レビュー依頼',
                  message: `「${task.title}」の修正が完了しました。再度レビューをお願いします。`,
                  link: `/approvals/${newApprovalRequest.id}`,
                },
              });
            }
          }
        })
        .catch((err) => log.error({ err }, 'Async operation failed'));

      return {
        success: true,
        message: '修正依頼を受け付けました。再実行を開始します。',
        sessionId: session.id,
      };
    } catch (error) {
      log.error({ err: error }, 'Request changes failed');
      throw error;
    }
  });
