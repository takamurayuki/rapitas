/**
 * Approvals — CodeReviewHandler
 *
 * Handles POST /approvals/:id/approve-code-review, POST /approvals/:id/reject-code-review,
 * and GET /approvals/:id/diff.
 * Not responsible for general approve/reject or request-changes workflows.
 */

import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { NotFoundError, ValidationError, parseId } from '../../../middleware/error-handler';
import { orchestrator } from '../../../services/orchestrator-instance';
import { GitHubService } from '../../../services/github-service';
import { toJsonString, fromJsonString } from '../../../utils/db-helpers';

const log = createLogger('routes:approvals:code-review');

const githubService = new GitHubService(prisma);

export const codeReviewRoutes = new Elysia()
  // Approve code review (commit + create PR)
  .post('/:id/approve-code-review', async (context) => {
    const params = context.params as { id: string };
    const body = context.body as { commitMessage: string; baseBranch?: string };
    const codeReviewApprovalId = parseId(params.id, 'approval ID');
    const { commitMessage, baseBranch = 'develop' } = body;

    const approval = await prisma.approvalRequest.findUnique({
      where: { id: codeReviewApprovalId },
      include: {
        config: {
          include: { task: { include: { theme: true } } },
        },
      },
    });

    if (!approval) {
      throw new NotFoundError('Approval request not found');
    }

    if (approval.status !== 'pending') {
      throw new ValidationError('Approval request is not pending');
    }

    if (approval.requestType !== 'code_review') {
      throw new ValidationError('This endpoint is only for code_review requests');
    }

    const proposedChanges = fromJsonString<{
      workingDirectory?: string;
      files?: string[];
    }>(approval.proposedChanges);

    const workingDirectory =
      proposedChanges?.workingDirectory || approval.config.task?.theme?.workingDirectory;

    if (!workingDirectory) {
      throw new NotFoundError('Working directory not found');
    }

    try {
      const commitResult = await orchestrator.createCommit(workingDirectory, commitMessage);

      const prResult = await githubService.createPullRequest(
        workingDirectory,
        commitResult.branch,
        baseBranch,
        `[Task-${approval.config.taskId}] ${commitMessage}`,
        `## 概要\n\n${approval.description || 'AIエージェントによる自動実装'}\n\n関連タスク: #${approval.config.taskId}`,
      );

      await prisma.approvalRequest.update({
        where: { id: codeReviewApprovalId },
        data: {
          status: 'approved',
          approvedAt: new Date(),
        },
      });

      if (prResult.prNumber) {
        await prisma.task.update({
          where: { id: approval.config.taskId },
          data: { githubPrId: prResult.prNumber },
        });
      }

      await prisma.notification.create({
        data: {
          type: 'pr_approved',
          title: 'PR作成完了',
          message: `「${approval.config.task.title}」のPRを作成しました`,
          link: prResult.prUrl || `/tasks/${approval.config.taskId}`,
          metadata: toJsonString({
            prNumber: prResult.prNumber,
            prUrl: prResult.prUrl,
            commitHash: commitResult.hash,
          }),
        },
      });

      return {
        success: true,
        commit: commitResult,
        pr: prResult,
      };
    } catch (error) {
      log.error({ err: error }, 'Code review approval failed');
      throw error;
    }
  })

  // Reject code review (discard changes)
  .post('/:id/reject-code-review', async (context) => {
    const rejectCodeReviewId = parseId(context.params.id, 'approval ID');
    const { reason } = context.body as { reason?: string };

    const approval = await prisma.approvalRequest.findUnique({
      where: { id: rejectCodeReviewId },
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
    }>(approval.proposedChanges);

    const workingDirectory =
      proposedChanges?.workingDirectory || approval.config.task?.theme?.workingDirectory;

    if (!workingDirectory) {
      throw new NotFoundError('Working directory not found');
    }

    try {
      const reverted = await orchestrator.revertChanges(workingDirectory);

      await prisma.approvalRequest.update({
        where: { id: rejectCodeReviewId },
        data: {
          status: 'rejected',
          rejectedAt: new Date(),
          rejectionReason: reason,
        },
      });

      await prisma.notification.create({
        data: {
          type: 'pr_changes_requested',
          title: 'Code Review Rejected',
          message: `Changes for "${approval.config.task.title}" have been discarded${reason ? `: ${reason}` : ''}`,
          link: `/tasks/${approval.config.taskId}`,
        },
      });

      return { success: true, reverted };
    } catch (error) {
      log.error({ err: error }, 'Code review rejection failed');
      throw error;
    }
  })

  // Get diff for an approval
  .get('/:id/diff', async (context) => {
    const { params } = context;
    const { id } = params as { id: string };
    const diffApprovalId = parseId(id, 'approval ID');

    const approval = await prisma.approvalRequest.findUnique({
      where: { id: diffApprovalId },
      include: {
        config: {
          include: { task: { include: { theme: true } } },
        },
      },
    });

    if (!approval) {
      throw new NotFoundError('Approval request not found');
    }

    const proposedChanges = fromJsonString<{
      workingDirectory?: string;
    }>(approval.proposedChanges);

    const workingDirectory =
      proposedChanges?.workingDirectory || approval.config.task?.theme?.workingDirectory;

    if (!workingDirectory) {
      throw new NotFoundError('Working directory not found');
    }

    try {
      const diff = await orchestrator.getDiff(workingDirectory);
      return { files: diff };
    } catch (error) {
      log.error({ err: error }, 'Failed to get diff');
      throw error;
    }
  });
