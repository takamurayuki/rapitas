/**
 * Approvals — ApproveHandler
 *
 * Handles POST /approvals/:id/approve for single approval requests.
 * Supports task_execution, code_review, and subtask_creation request types.
 * Not responsible for bulk approval, rejection, or code-review-specific workflows.
 */

import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { NotFoundError, ValidationError, parseId } from '../../../middleware/error-handler';
import { orchestrator } from '../../../services/core/orchestrator-instance';
import { toJsonString, fromJsonString } from '../../../utils/database/db-helpers';
import type { SubtaskProposal } from '../../../services/claude-agent';
import { createSubtasksInTransaction } from './bulk-approve-handler';
import { resolveAgentForTask } from '../../../services/workflow/role-resolver';

const log = createLogger('routes:approvals:approve');

export const approveRoutes = new Elysia()
  // Approve a single request
  .post('/:id/approve', async (context) => {
    const params = context.params as { id: string };
    const body = context.body as { selectedSubtasks?: number[] };
    const approvalId = parseId(params.id, 'approval ID');
    const { selectedSubtasks } = body;

    const approval = await prisma.approvalRequest.findUnique({
      where: { id: approvalId },
      include: {
        config: {
          include: { task: true },
        },
      },
    });

    if (!approval) {
      throw new NotFoundError('Approval request not found');
    }

    if (approval.status !== 'pending') {
      throw new ValidationError('Approval request is not pending');
    }

    await prisma.approvalRequest.update({
      where: { id: approvalId },
      data: {
        status: 'approved',
        approvedAt: new Date(),
      },
    });

    // --- task_execution ---
    if (approval.requestType === 'task_execution') {
      const proposedChanges = fromJsonString<{
        taskId: number;
        agentConfigId?: number;
        workingDirectory?: string;
      }>(approval.proposedChanges);

      if (!proposedChanges) {
        throw new ValidationError('Invalid proposed changes data');
      }

      const task = approval.config.task;

      // WorkflowRoleConfig is the source of truth for agent selection. Override
      // the approval's stored agentConfigId with the role-resolved value when
      // the task has a workflow context, so 「ロール設定通りに実行される」 holds
      // for both manual /agents/execute and approval-triggered execution.
      let resolvedAgentConfigId = proposedChanges.agentConfigId;
      const roleAgent = await resolveAgentForTask(task.id);
      if (roleAgent?.agentConfigId) {
        if (resolvedAgentConfigId !== roleAgent.agentConfigId) {
          log.info(
            `[approve] Task ${task.id}: WorkflowRoleConfig override — role=${roleAgent.role}, agentConfigId=${roleAgent.agentConfigId} (was ${resolvedAgentConfigId ?? 'default'})`,
          );
        }
        resolvedAgentConfigId = roleAgent.agentConfigId;
      }

      const session = await prisma.agentSession.create({
        data: {
          configId: approval.config.id,
          status: 'pending',
        },
      });

      await prisma.notification.create({
        data: {
          type: 'agent_execution_started',
          title: 'Agent Execution Started',
          message: `Started automatic execution of approved task "${task.title}"`,
          link: `/tasks/${task.id}`,
          metadata: toJsonString({ sessionId: session.id, taskId: task.id }),
        },
      });

      orchestrator
        .executeTask(
          {
            id: task.id,
            title: task.title,
            description: task.description,
            context: task.executionInstructions || undefined,
            workingDirectory: proposedChanges.workingDirectory,
          },
          {
            taskId: task.id,
            sessionId: session.id,
            agentConfigId: resolvedAgentConfigId,
            workingDirectory: proposedChanges.workingDirectory,
          },
        )
        .then(async (result) => {
          await prisma.notification.create({
            data: {
              type: 'agent_execution_complete',
              title: result.success ? 'Agent Execution Complete' : 'Agent Execution Failed',
              message: result.success
                ? `Automatic execution of "${task.title}" completed successfully`
                : `Automatic execution of "${task.title}" failed: ${result.errorMessage}`,
              link: `/tasks/${task.id}`,
              metadata: toJsonString({
                sessionId: session.id,
                taskId: task.id,
                success: result.success,
              }),
            },
          });

          if (result.success) {
            await prisma.task.update({
              where: { id: task.id },
              data: { status: 'done', completedAt: new Date() },
            });
          }
        })
        .catch(async (error) => {
          log.error({ err: error }, 'Agent execution failed');
          await prisma.notification.create({
            data: {
              type: 'agent_error',
              title: 'Agent Execution Error',
              message: `An error occurred during execution of "${task.title}"`,
              link: `/tasks/${task.id}`,
            },
          });
        });

      return { success: true, sessionId: session.id, autoExecutionStarted: true };
    }

    // --- code_review ---
    if (approval.requestType === 'code_review') {
      const proposedChanges = fromJsonString<{
        taskId: number;
        sessionId: number;
        workingDirectory: string;
        branchName?: string;
        diff: string;
      }>(approval.proposedChanges);

      if (!proposedChanges) {
        throw new ValidationError('Invalid proposed changes data');
      }

      const task = approval.config.task;
      const workDir = proposedChanges.workingDirectory;
      const commitResult = await orchestrator.commitChanges(
        workDir,
        `feat: ${task.title}`,
        task.title,
      );

      if (!commitResult.success) {
        await prisma.notification.create({
          data: {
            type: 'agent_error',
            title: 'Commit Failed',
            message: `Commit failed for "${task.title}": ${commitResult.error}`,
            link: `/tasks/${task.id}`,
          },
        });
        return { success: false, error: commitResult.error };
      }

      const prBody = `## Overview\n${task.description || task.title}\n\n## Changes\nAutomatic implementation by Claude Code\n\n## Related Tasks\nTask ID: ${task.id}\n\n---\n🤖 Generated by rapitas AI Development Mode`;
      const prResult = await orchestrator.createPullRequest(workDir, task.title, prBody);

      if (prResult.success) {
        if (prResult.prNumber) {
          await prisma.task.update({ where: { id: task.id }, data: { status: 'in_review' } });
        }
        await prisma.notification.create({
          data: {
            type: 'pr_approved',
            title: 'PR Created Successfully',
            message: `PR created for "${task.title}"`,
            link: prResult.prUrl || `/tasks/${task.id}`,
            metadata: toJsonString({
              taskId: task.id,
              commitHash: commitResult.commitHash,
              prUrl: prResult.prUrl,
              prNumber: prResult.prNumber,
            }),
          },
        });
        return {
          success: true,
          commitHash: commitResult.commitHash,
          prUrl: prResult.prUrl,
          prNumber: prResult.prNumber,
        };
      } else {
        await prisma.notification.create({
          data: {
            type: 'agent_error',
            title: 'PR Creation Failed',
            message: `PR creation failed for "${task.title}": ${prResult.error}`,
            link: `/tasks/${task.id}`,
            metadata: toJsonString({ commitHash: commitResult.commitHash }),
          },
        });
        return { success: false, commitHash: commitResult.commitHash, error: prResult.error };
      }
    }

    // --- subtask_creation ---
    if (approval.requestType === 'subtask_creation') {
      const proposedChanges = fromJsonString<{
        subtasks: SubtaskProposal[];
      }>(approval.proposedChanges);

      if (!proposedChanges) {
        throw new ValidationError('Invalid proposed changes data');
      }

      const subtasksToCreate = selectedSubtasks
        ? proposedChanges.subtasks.filter((_, i) => selectedSubtasks.includes(i))
        : proposedChanges.subtasks;

      // NOTE: Serializable isolation prevents concurrent duplicate subtask creation
      const createdSubtasks = await prisma.$transaction(
        async (tx) => createSubtasksInTransaction(tx, approval.config.taskId, subtasksToCreate),
        { isolationLevel: 'Serializable' },
      );

      await prisma.notification.create({
        data: {
          type: 'task_completed',
          title: 'Subtask Creation Complete',
          message: `${createdSubtasks.length} subtasks were created for "${approval.config.task.title}"`,
          link: `/tasks/${approval.config.taskId}`,
        },
      });

      return { success: true, createdSubtasks };
    }

    // Other request types
    await prisma.notification.create({
      data: {
        type: 'approval_request',
        title: 'Approval Complete',
        message: `Request has been approved`,
        link: `/tasks/${approval.config.taskId}`,
      },
    });

    return { success: true };
  });
