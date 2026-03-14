/**
 * Approvals API Routes
 * Task execution approval, code review, and subtask creation workflows
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { NotFoundError, ValidationError, parseId } from '../../middleware/error-handler';

const log = createLogger('routes:approvals');
import { orchestrator } from '../../services/orchestrator-instance';
import { GitHubService } from '../../services/github-service';
import { toJsonString, fromJsonString } from '../../utils/db-helpers';
import type { SubtaskProposal } from '../../services/claude-agent';
import {
  captureScreenshotsForDiff,
  type ScreenshotResult,
} from '../../services/screenshot-service';

// Create service instances
const githubService = new GitHubService(prisma);

// Re-export orchestrator for backward compatibility
export { orchestrator };

// Helper to parse JSON fields stored as Prisma String type
interface ApprovalWithChanges {
  id: number;
  proposedChanges: string | Record<string, unknown> | null;
  estimatedChanges: string | Record<string, unknown> | null;
  [key: string]: unknown;
}

function parseApprovalJsonFields(approval: ApprovalWithChanges | null) {
  if (!approval) return approval;

  let proposedChanges = approval.proposedChanges;
  if (typeof proposedChanges === 'string') {
    proposedChanges = fromJsonString(proposedChanges);
    if (proposedChanges === null) {
      log.error(`[approvals] Failed to parse proposedChanges for approval ${approval.id}`);
      proposedChanges = {};
    }
  }

  // NOTE: Exclude raw diff (plain text) from proposedChanges to reduce response size.
  // structuredDiff is kept because the front-end DiffViewer uses it.
  // Raw diff can be fetched separately via /approvals/:id/diff.
  const parsedChanges = (proposedChanges || {}) as Record<string, unknown>;
  const { diff: _diff, ...proposedChangesWithoutDiff } = parsedChanges;

  let estimatedChanges =
    typeof approval.estimatedChanges === 'string'
      ? fromJsonString(approval.estimatedChanges)
      : approval.estimatedChanges;
  // Also exclude diff from estimatedChanges
  if (estimatedChanges && typeof estimatedChanges === 'object' && 'diff' in estimatedChanges) {
    const { diff: _estDiff, ...estWithoutDiff } = estimatedChanges as Record<string, unknown>;
    estimatedChanges = estWithoutDiff;
  }

  const parsed = {
    ...approval,
    proposedChanges: proposedChangesWithoutDiff,
    estimatedChanges,
  };

  // Debug logging for screenshot presence
  const screenshots = parsed.proposedChanges?.screenshots as Array<{ url: string }> | undefined;
  if (screenshots && screenshots.length > 0) {
    log.info(
      `[approvals] Approval ${approval.id} has ${screenshots.length} screenshot(s): ${screenshots.map((s) => s.url).join(', ')}`,
    );
  } else {
    log.info(
      `[approvals] Approval ${approval.id} has no screenshots. Keys: ${Object.keys(parsed.proposedChanges || {}).join(', ')}`,
    );
  }
  return parsed;
}

export const approvalsRoutes = new Elysia({ prefix: '/approvals' })
  // Get approval list
  .get('/', async (context) => {
    const { query } = context;
    const { status } = query as { status?: string };
    const approvals = await prisma.approvalRequest.findMany({
      where: status ? { status } : { status: 'pending' },
      include: {
        config: {
          include: {
            task: {
              include: {
                theme: {
                  select: {
                    defaultBranch: true,
                    workingDirectory: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return approvals.map(parseApprovalJsonFields);
  })

  // Get approval details
  .get('/:id', async (context) => {
    const { params } = context;
    const { id } = params as { id: string };
    const approvalId = parseId(id, 'approval ID');
    const approval = await prisma.approvalRequest.findUnique({
      where: { id: approvalId },
      include: {
        config: {
          include: {
            task: {
              include: {
                theme: {
                  select: {
                    defaultBranch: true,
                    workingDirectory: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    return parseApprovalJsonFields(approval);
  })

  // Approve request
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

    // Update approval request
    await prisma.approvalRequest.update({
      where: { id: approvalId },
      data: {
        status: 'approved',
        approvedAt: new Date(),
      },
    });

    // Handle by request type
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

      // Create session
      const session = await prisma.agentSession.create({
        data: {
          configId: approval.config.id,
          status: 'pending',
        },
      });

      // Create notification
      await prisma.notification.create({
        data: {
          type: 'agent_execution_started',
          title: 'Agent Execution Started',
          message: `Started automatic execution of approved task "${task.title}"`,
          link: `/tasks/${task.id}`,
          metadata: toJsonString({ sessionId: session.id, taskId: task.id }),
        },
      });

      // Start agent execution asynchronously
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
            agentConfigId: proposedChanges.agentConfigId,
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

      return {
        success: true,
        sessionId: session.id,
        autoExecutionStarted: true,
      };
    } else if (approval.requestType === 'code_review') {
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

      const commitMessage = `feat: ${task.title}`;

      const commitResult = await orchestrator.commitChanges(workDir, commitMessage, task.title);

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

      const prBody = `## Overview
${task.description || task.title}

## Changes
Automatic implementation by Claude Code

## Related Tasks
Task ID: ${task.id}

---
🤖 Generated by rapitas AI Development Mode`;

      const prResult = await orchestrator.createPullRequest(workDir, task.title, prBody, 'main');

      if (prResult.success) {
        if (prResult.prNumber) {
          await prisma.task.update({
            where: { id: task.id },
            data: { status: 'in_review' },
          });
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

        return {
          success: false,
          commitHash: commitResult.commitHash,
          error: prResult.error,
        };
      }
    } else if (approval.requestType === 'subtask_creation') {
      const proposedChanges = fromJsonString<{
        subtasks: SubtaskProposal[];
      }>(approval.proposedChanges);

      if (!proposedChanges) {
        throw new ValidationError('Invalid proposed changes data');
      }

      const subtasksToCreate = selectedSubtasks
        ? proposedChanges.subtasks.filter((_, i) => selectedSubtasks.includes(i))
        : proposedChanges.subtasks;

      // Atomically check for duplicates and create subtasks in a transaction
      const createdSubtasks = await prisma.$transaction(
        async (tx) => {
          // Fetch existing subtasks inside the transaction to prevent races
          const existingSubtasks = await tx.task.findMany({
            where: { parentId: approval.config.taskId },
            select: { title: true },
          });
          const existingTitles = new Set(
            existingSubtasks.map((st: { title: string }) => st.title.toLowerCase().trim()),
          );

          const created = [];
          for (const subtask of subtasksToCreate) {
            // Skip subtasks with duplicate titles
            const normalizedTitle = subtask.title.toLowerCase().trim();
            if (existingTitles.has(normalizedTitle)) {
              log.info(`[approvals] Skipping duplicate subtask: ${subtask.title}`);
              continue;
            }
            existingTitles.add(normalizedTitle);

            const newSubtask = await tx.task.create({
              data: {
                title: subtask.title,
                description: subtask.description,
                priority: subtask.priority,
                estimatedHours: subtask.estimatedHours,
                parentId: approval.config.taskId,
                agentGenerated: true,
              },
            });
            created.push(newSubtask);
          }
          return created;
        },
        {
          isolationLevel: 'Serializable', // NOTE: Serializable prevents concurrent duplicate creation
        },
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
  })

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

  // Approve code review (commit + create PR)
  .post('/:id/approve-code-review', async (context) => {
    const params = context.params as { id: string };
    const body = context.body as { commitMessage: string; baseBranch?: string };
    const codeReviewApprovalId = parseId(params.id, 'approval ID');
    const { commitMessage, baseBranch = 'main' } = body;

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

  // Request changes (send feedback and re-execute)
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
      // Revert changes
      await orchestrator.revertChanges(workingDirectory);

      // Build feedback instructions
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

      // Update approval status
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

      // Create new session for re-execution
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

      // Execute agent asynchronously
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

              // Capture screenshots when UI-related files changed
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
  })

  // Get diff
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
  })

  // Bulk approve
  .post('/bulk-approve', async (context) => {
    const { body } = context;
    const { ids } = body as { ids: number[] };

    // Batch fetch all approval requests at once
    const allApprovals = await prisma.approvalRequest.findMany({
      where: { id: { in: ids }, status: 'pending' },
      include: {
        config: {
          include: { task: true },
        },
      },
    });
    const approvalMap = new Map(allApprovals.map((a) => [a.id, a]));

    // Batch update all statuses at once
    await prisma.approvalRequest.updateMany({
      where: { id: { in: allApprovals.map((a) => a.id) } },
      data: { status: 'approved', approvedAt: new Date() },
    });

    const results = [];
    for (const id of ids) {
      try {
        const approval = approvalMap.get(id);
        if (!approval) continue;

        if (approval.requestType === 'task_execution') {
          const proposedChanges = fromJsonString<{
            taskId: number;
            agentConfigId?: number;
            workingDirectory?: string;
          }>(approval.proposedChanges);
          const task = approval.config.task;

          const session = await prisma.agentSession.create({
            data: {
              configId: approval.config.id,
              status: 'pending',
            },
          });

          orchestrator
            .executeTask(
              {
                id: task.id,
                title: task.title,
                description: task.description,
                context: task.executionInstructions || undefined,
                workingDirectory: proposedChanges?.workingDirectory,
              },
              {
                taskId: task.id,
                sessionId: session.id,
                agentConfigId: proposedChanges?.agentConfigId,
                workingDirectory: proposedChanges?.workingDirectory,
              },
            )
            .then(async (result) => {
              await prisma.notification.create({
                data: {
                  type: result.success ? 'agent_execution_complete' : 'agent_error',
                  title: result.success ? 'エージェント実行完了' : 'エージェント実行失敗',
                  message: result.success
                    ? `「${task.title}」の自動実行が完了しました`
                    : `「${task.title}」の自動実行が失敗しました`,
                  link: `/tasks/${task.id}`,
                },
              });
              if (result.success) {
                await prisma.task.update({
                  where: { id: task.id },
                  data: { status: 'done', completedAt: new Date() },
                });
              }
            })
            .catch((err) => log.error({ err }, 'Async operation failed'));

          results.push({ id, success: true, autoExecutionStarted: true });
        } else if (approval.requestType === 'subtask_creation') {
          const proposedChanges = fromJsonString<{
            subtasks: SubtaskProposal[];
          }>(approval.proposedChanges);

          // Atomically check for duplicates and create subtasks in a transaction
          const createdSubtasks = await prisma.$transaction(
            async (tx) => {
              const existingSubtasks = await tx.task.findMany({
                where: { parentId: approval.config.taskId },
                select: { title: true },
              });
              const existingTitles = new Set(
                existingSubtasks.map((st: { title: string }) => st.title.toLowerCase().trim()),
              );

              const created = [];
              for (const subtask of proposedChanges?.subtasks || []) {
                const normalizedTitle = subtask.title.toLowerCase().trim();
                if (existingTitles.has(normalizedTitle)) {
                  log.info(`[approvals:bulk] Skipping duplicate subtask: ${subtask.title}`);
                  continue;
                }
                existingTitles.add(normalizedTitle);

                const newSubtask = await tx.task.create({
                  data: {
                    title: subtask.title,
                    description: subtask.description,
                    priority: subtask.priority,
                    estimatedHours: subtask.estimatedHours,
                    parentId: approval.config.taskId,
                    agentGenerated: true,
                  },
                });
                created.push(newSubtask);
              }
              return created;
            },
            {
              isolationLevel: 'Serializable',
            },
          );

          results.push({ id, success: true, createdCount: createdSubtasks.length });
        } else {
          results.push({ id, success: true });
        }
      } catch (error) {
        results.push({ id, success: false });
      }
    }

    return { results };
  });
