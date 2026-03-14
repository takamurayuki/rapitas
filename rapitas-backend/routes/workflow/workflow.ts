/**
 * Workflow Routes
 * Manages AI agent workflow files (research.md, question.md, plan.md, verify.md)
 */
import { Elysia } from 'elysia';
import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { prisma, getProjectRoot } from '../../config';
import { NotFoundError, ValidationError, parseId } from '../../middleware/error-handler';
import { sanitizeMarkdownContent } from '../../utils/mojibake-detector';
import {
  analyzeTaskComplexity,
  analyzeTaskComplexityWithLearning,
  getWorkflowModeConfig,
  type TaskComplexityInput,
} from '../../services/workflow/complexity-analyzer';
import { AgentOrchestrator } from '../../services/agents/agent-orchestrator';
import { createLogger } from '../../config/logger';
import { recordWorkflowCompletion } from '../../services/workflow/workflow-learning-optimizer';
import { extractKnowledgeFromTask } from '../../services/memory/task-knowledge-extractor';

const log = createLogger('routes:workflow');

const VALID_FILE_TYPES = ['research', 'question', 'plan', 'verify'] as const;
type WorkflowFileType = (typeof VALID_FILE_TYPES)[number];

const VALID_WORKFLOW_STATUSES = [
  'draft',
  'research_done',
  'plan_created',
  'plan_approved',
  'in_progress',
  'verify_done',
  'completed',
] as const;

/**
 * Resolve the workflow directory path from a task ID.
 * Traverses Task -> Theme -> Category relations to get IDs.
 */
async function resolveWorkflowDir(taskId: number) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { theme: { include: { category: true } } },
  });

  if (!task) return null;

  const categoryId = task.theme?.categoryId ?? null;
  const themeId = task.themeId ?? null;

  const categoryDir = categoryId !== null ? String(categoryId) : '0';
  const themeDir = themeId !== null ? String(themeId) : '0';

  return {
    task,
    dir: join(process.cwd(), 'tasks', categoryDir, themeDir, String(taskId)),
    categoryId,
    themeId,
  };
}

/**
 * Get file info.
 */
async function getFileInfo(filePath: string, fileType: WorkflowFileType) {
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

/**
 * Auto-commit and PR creation after verify.md is saved.
 */
async function performAutoCommitAndPR(taskId: number, verifyContent: string) {
  const result: {
    autoCommitResult?: {
      success: boolean;
      hash?: string;
      branch?: string;
      filesChanged?: number;
      error?: string;
    };
    autoPRResult?: { success: boolean; prUrl?: string; prNumber?: number; error?: string };
    autoMergeResult?: { success: boolean; mergeStrategy?: string; error?: string };
  } = {};

  try {
    // Get AgentExecutionConfig and check autoCommit/autoCreatePR settings
    const execConfig = await prisma.agentExecutionConfig.findUnique({
      where: { taskId },
    });

    if (
      !execConfig ||
      (!execConfig.autoCommit && !execConfig.autoCreatePR && !execConfig.autoMergePR)
    ) {
      return result;
    }

    
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        theme: true,
        developerModeConfig: {
          include: {
            agentSessions: {
              orderBy: { lastActivityAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    if (!task) return result;

    // Resolve workingDirectory: AgentExecutionConfig → theme → cwd
    const workingDirectory =
      execConfig.workingDirectory || task.theme?.workingDirectory || getProjectRoot();

    
    const latestSession = task.developerModeConfig?.agentSessions?.[0];
    const branchName = latestSession?.branchName;

    // Resolve target branch: execConfig -> theme -> 'master'
    const targetBranch =
      ((execConfig as Record<string, unknown>).targetBranch as string) ||
      task.theme?.defaultBranch ||
      'master';

    const orchestrator = AgentOrchestrator.getInstance(prisma);

    // Process autoCommit
    if (execConfig.autoCommit) {
      try {
        // Checkout branch if set
        if (branchName) {
          await orchestrator.createBranch(workingDirectory, branchName);
        }

        const commitMessage = `feat(task-${taskId}): ${task.title}`;
        const commitResult = await orchestrator.createCommit(workingDirectory, commitMessage);
        result.autoCommitResult = {
          success: true,
          hash: commitResult.hash,
          branch: commitResult.branch,
          filesChanged: commitResult.filesChanged,
        };

        log.info(`[Workflow] Auto-commit successful for task ${taskId}: ${commitResult.hash}`);

        // Record in ActivityLog
        await prisma.activityLog.create({
          data: {
            taskId,
            action: 'auto_commit_created',
            metadata: JSON.stringify({
              hash: commitResult.hash,
              branch: commitResult.branch,
              filesChanged: commitResult.filesChanged,
              additions: commitResult.additions,
              deletions: commitResult.deletions,
            }),
            createdAt: new Date(),
          },
        });
      } catch (commitError) {
        log.error({ err: commitError }, `[Workflow] Auto-commit failed for task ${taskId}`);
        result.autoCommitResult = {
          success: false,
          error: commitError instanceof Error ? commitError.message : String(commitError),
        };
      }
    }

    // Process autoCreatePR (only if autoCommit succeeded)
    if (execConfig.autoCreatePR && result.autoCommitResult?.success) {
      try {
        const prTitle = `[Task-${taskId}] ${task.title}`;
        const prBody = `## Summary\n\nAuto-generated PR for Task #${taskId}: ${task.title}\n\n## Verification Report\n\n${verifyContent}\n\n---\n🤖 Generated automatically by Rapitas AI Agent`;

        const prResult = await orchestrator.createPullRequest(
          workingDirectory,
          prTitle,
          prBody,
          targetBranch,
        );

        result.autoPRResult = prResult;

        if (prResult.success) {
          log.info(`[Workflow] Auto-PR created for task ${taskId}: ${prResult.prUrl}`);

          // Record in ActivityLog
          await prisma.activityLog.create({
            data: {
              taskId,
              action: 'auto_pr_created',
              metadata: JSON.stringify({
                prUrl: prResult.prUrl,
                prNumber: prResult.prNumber,
              }),
              createdAt: new Date(),
            },
          });

          
          await prisma.notification.create({
            data: {
              type: 'auto_pr_created',
              title: 'Auto PR Creation Complete',
              message: `PR for task "${task.title}" was automatically created: ${prResult.prUrl}`,
              link: prResult.prUrl || `/tasks/${taskId}`,
              metadata: JSON.stringify({
                taskId,
                prUrl: prResult.prUrl,
                prNumber: prResult.prNumber,
              }),
            },
          });
        } else {
          log.error(
            { error: prResult.error },
            `[Workflow] Auto-PR creation failed for task ${taskId}`,
          );
        }
      } catch (prError) {
        log.error({ err: prError }, `[Workflow] Auto-PR failed for task ${taskId}`);
        result.autoPRResult = {
          success: false,
          error: prError instanceof Error ? prError.message : String(prError),
        };
      }
    }

    // Process autoMergePR (only if autoCreatePR succeeded)
    if (execConfig.autoMergePR && result.autoPRResult?.success && result.autoPRResult?.prNumber) {
      try {
        const mergeResult = await orchestrator.mergePullRequest(
          workingDirectory,
          result.autoPRResult.prNumber,
          execConfig.mergeCommitThreshold ?? 5,
          targetBranch,
        );

        result.autoMergeResult = mergeResult;

        if (mergeResult.success) {
          log.info(
            `[Workflow] Auto-merge successful for task ${taskId}: strategy=${mergeResult.mergeStrategy}`,
          );

          // Record in ActivityLog
          await prisma.activityLog.create({
            data: {
              taskId,
              action: 'auto_pr_merged',
              metadata: JSON.stringify({
                prNumber: result.autoPRResult.prNumber,
                prUrl: result.autoPRResult.prUrl,
                mergeStrategy: mergeResult.mergeStrategy,
              }),
              createdAt: new Date(),
            },
          });

          
          await prisma.notification.create({
            data: {
              type: 'auto_pr_merged',
              title: 'Auto Merge Complete',
              message: `PR for task "${task.title}" was automatically merged (${mergeResult.mergeStrategy})`,
              link: result.autoPRResult.prUrl || `/tasks/${taskId}`,
              metadata: JSON.stringify({
                taskId,
                prNumber: result.autoPRResult.prNumber,
                mergeStrategy: mergeResult.mergeStrategy,
              }),
            },
          });
        } else {
          log.error(
            { error: mergeResult.error },
            `[Workflow] Auto-merge failed for task ${taskId}`,
          );

          // Failure notification (does not fail the whole workflow)
          await prisma.notification.create({
            data: {
              type: 'auto_pr_merge_failed',
              title: 'Auto Merge Failed',
              message: `Automatic merge of PR for task "${task.title}" failed: ${mergeResult.error}`,
              link: result.autoPRResult.prUrl || `/tasks/${taskId}`,
              metadata: JSON.stringify({
                taskId,
                prNumber: result.autoPRResult.prNumber,
                error: mergeResult.error,
              }),
            },
          });
        }
      } catch (mergeError) {
        log.error({ err: mergeError }, `[Workflow] Auto-merge failed for task ${taskId}`);
        result.autoMergeResult = {
          success: false,
          error: mergeError instanceof Error ? mergeError.message : String(mergeError),
        };
      }
    }
  } catch (error) {
    log.error({ err: error }, `[Workflow] Auto-commit/PR process failed for task ${taskId}`);
  }

  return result;
}

export const workflowRoutes = new Elysia({ prefix: '/workflow' })

  // Get workflow files list
  .get('/tasks/:taskId/files', async ({ params, set }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');

      const resolved = await resolveWorkflowDir(taskId);
      if (!resolved) {
        throw new NotFoundError('Task not found');
      }

      const { task, dir, categoryId, themeId } = resolved;

      // Parallel retrieval of 4 file information
      const [research, question, plan, verify] = await Promise.all(
        VALID_FILE_TYPES.map((type) => getFileInfo(join(dir, `${type}.md`), type)),
      );

      return {
        research,
        question,
        plan,
        verify,
        workflowStatus: task.workflowStatus || null,
        path: {
          taskId,
          categoryId,
          themeId,
          dir: `tasks/${categoryId ?? 0}/${themeId ?? 0}/${taskId}`,
        },
      };
    } catch (err) {
      if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
      log.error({ err: err }, 'Error fetching workflow files');
      throw err;
    }
  })

  // Save workflow file
  .put('/tasks/:taskId/files/:fileType', async ({ params, body, set }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');

      const fileType = params.fileType as WorkflowFileType;
      if (!VALID_FILE_TYPES.includes(fileType)) {
        throw new ValidationError(
          `Invalid file type. Must be one of: ${VALID_FILE_TYPES.join(', ')}`,
        );
      }

      const resolved = await resolveWorkflowDir(taskId);
      if (!resolved) {
        throw new NotFoundError('Task not found');
      }

      const { dir } = resolved;
      const parsedBody = body as { content: string };
      if (!parsedBody?.content && parsedBody?.content !== '') {
        throw new ValidationError('content is required');
      }

      
      await mkdir(dir, { recursive: true });

      // Mojibake detection and sanitization
      const sanitizeResult = sanitizeMarkdownContent(parsedBody.content);
      const mojibakeFixed = sanitizeResult.wasFixed;
      if (sanitizeResult.wasFixed) {
        log.info(
          { issues: sanitizeResult.issues },
          `[Workflow API] Fixed mojibake in ${fileType}.md for task ${taskId}`,
        );
      }

      
      const filePath = join(dir, `${fileType}.md`);
      await writeFile(filePath, sanitizeResult.content, 'utf-8');

      // Auto-update workflowStatus
      let newStatus: string | undefined;
      const currentStatus = resolved.task.workflowStatus;

      log.info(`[Workflow] Processing fileType: ${fileType}, currentStatus: ${currentStatus}`);

      if (fileType === 'research' && (!currentStatus || currentStatus === 'draft')) {
        log.info(`[Workflow] Research completed: setting newStatus to research_done`);
        newStatus = 'research_done';
      } else if (fileType === 'plan' && (!currentStatus || currentStatus === 'research_done')) {
        newStatus = 'plan_created';
      } else if (fileType === 'verify') {
        log.info(
          `[Workflow] Processing verify.md for task ${taskId}, currentStatus: ${currentStatus}`,
        );
        log.info(`[Workflow] Unconditionally setting newStatus to completed`);
        newStatus = 'completed';
      }

      log.info(`[Workflow] newStatus after condition checks: ${newStatus}`);

      if (newStatus) {
        log.info(`[Workflow] Updating workflowStatus to: ${newStatus}`);
        await prisma.task.update({
          where: { id: taskId },
          data: { workflowStatus: newStatus, updatedAt: new Date() },
        });
        log.info(`[Workflow] workflowStatus updated successfully`);
      } else {
        log.info(`[Workflow] newStatus is falsy, skipping workflowStatus update`);
      }

      // Auto-approve when saving plan.md if autoApprovePlan is enabled
      let autoApproved = false;
      if (fileType === 'plan' && newStatus === 'plan_created') {
        const userSettings = await prisma.userSettings.findFirst();
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          select: { autoApprovePlan: true, parentId: true },
        });

        // Subtask check
        const isSubtask = task?.parentId !== null && task?.parentId !== undefined;

        // Auto-approve if any of task-level / global / subtask auto-approve is enabled
        const shouldAutoApprove =
          task?.autoApprovePlan ||
          userSettings?.autoApprovePlan ||
          (isSubtask && (userSettings as Record<string, unknown>)?.autoApproveSubtaskPlan);

        if (shouldAutoApprove) {
          // Auto-approve: transition to plan_approved
          await prisma.task.update({
            where: { id: taskId },
            data: { workflowStatus: 'plan_approved', updatedAt: new Date() },
          });
          newStatus = 'plan_approved';
          autoApproved = true;

          // Record auto-approval in ActivityLog
          const approvalReason = task?.autoApprovePlan
            ? 'task-level autoApprovePlan setting enabled'
            : isSubtask && (userSettings as Record<string, unknown>)?.autoApproveSubtaskPlan
              ? 'subtask autoApproveSubtaskPlan setting enabled'
              : 'global autoApprovePlan setting enabled';

          await prisma.activityLog.create({
            data: {
              taskId,
              action: 'plan_auto_approved',
              metadata: JSON.stringify({
                previousStatus: 'plan_created',
                newStatus: 'plan_approved',
                reason: approvalReason,
                taskLevelSetting: task?.autoApprovePlan || false,
                globalLevelSetting: userSettings?.autoApprovePlan || false,
                subtaskAutoApprove:
                  isSubtask && !!(userSettings as Record<string, unknown>)?.autoApproveSubtaskPlan,
                isSubtask,
              }),
              createdAt: new Date(),
            },
          });

          // Automatically start the implementation phase
          try {
            const { WorkflowOrchestrator } =
              await import('../../services/workflow/workflow-orchestrator');
            const orchestrator = WorkflowOrchestrator.getInstance();
            orchestrator
              .advanceWorkflow(taskId)
              .then((result) => {
                log.info(
                  `[Workflow] Auto-advance after auto-approval for task ${taskId}: ${result.success ? 'success' : result.error}`,
                );
              })
              .catch((err) => {
                log.error(
                  { err: err },
                  `[Workflow] Auto-advance after auto-approval failed for task ${taskId}`,
                );
              });
          } catch (err) {
            log.error({ err: err }, '[Workflow] Failed to auto-advance after auto-approval');
          }
        }
      }

      // Auto commit and PR creation when saving verify.md
      let autoCommitPRResult: Awaited<ReturnType<typeof performAutoCommitAndPR>> = {};
      if (fileType === 'verify' && newStatus === 'completed') {
        autoCommitPRResult = await performAutoCommitAndPR(taskId, sanitizeResult.content);

        // Collect workflow learning data asynchronously (fire-and-forget)
        recordWorkflowCompletion(taskId).catch((err) => {
          log.error({ err, taskId }, 'Failed to record workflow learning data');
        });

        // Auto-extract knowledge on task completion (async)
        extractKnowledgeFromTask(taskId).catch((err) => {
          log.error({ err, taskId }, 'Failed to extract knowledge from task');
        });
      }

      // Build response
      const response: {
        success: boolean;
        fileType: string;
        path: string;
        workflowStatus: string | null;
        autoApproved: boolean;
        taskCompleted?: boolean;
        taskStatus?: string;
        completedAt?: string;
        autoCommit?: {
          success: boolean;
          hash?: string;
          branch?: string;
          filesChanged?: number;
          error?: string;
        };
        autoPR?: { success: boolean; prUrl?: string; prNumber?: number; error?: string };
        autoMerge?: { success: boolean; mergeStrategy?: string; error?: string };
      } = {
        success: true,
        fileType,
        path: filePath,
        workflowStatus: newStatus || currentStatus,
        autoApproved,
      };

      // Additional information when completed by saving verify.md file
      if (fileType === 'verify' && newStatus === 'completed') {
        response.taskCompleted = true;
        response.taskStatus = 'done';
        response.completedAt = new Date().toISOString();

        // Include auto-commit/PR results
        if (autoCommitPRResult.autoCommitResult) {
          response.autoCommit = autoCommitPRResult.autoCommitResult;
        }
        if (autoCommitPRResult.autoPRResult) {
          response.autoPR = autoCommitPRResult.autoPRResult;
        }
        if (autoCommitPRResult.autoMergeResult) {
          response.autoMerge = autoCommitPRResult.autoMergeResult;
        }
      }

      return response;
    } catch (err) {
      if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
      log.error({ err: err }, 'Error saving workflow file');
      throw err;
    }
  })

  // Plan approval
  .post('/tasks/:taskId/approve-plan', async ({ params, body, set }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');

      const parsedBody = body as { approved: boolean; reason?: string };
      if (typeof parsedBody?.approved !== 'boolean') {
        throw new ValidationError('approved (boolean) is required');
      }

      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) {
        throw new NotFoundError('Task not found');
      }

      let newStatus: string;
      if (parsedBody.approved) {
        // Approve: transition to plan_approved (implementer agent can now run)
        newStatus = 'plan_approved';
      } else {
        // Reject: revert to plan_created
        newStatus = 'plan_created';
      }

      const updatedTask = await prisma.task.update({
        where: { id: taskId },
        data: { workflowStatus: newStatus, updatedAt: new Date() },
      });

      // Record in ActivityLog
      await prisma.activityLog.create({
        data: {
          taskId,
          action: parsedBody.approved ? 'plan_approved' : 'plan_rejected',
          metadata: JSON.stringify({
            reason: parsedBody.reason,
            previousStatus: task.workflowStatus,
            newStatus,
          }),
          createdAt: new Date(),
        },
      });

      // If approved, auto-start the implementation phase
      if (parsedBody.approved) {
        try {
          // Resume via orchestra queue if task is queued
          const { AIOrchestra } = await import('../../services/workflow/ai-orchestra');
          AIOrchestra.getInstance()
            .handlePlanApproved(taskId)
            .catch((err) => {
              log.warn(
                { err },
                `[Workflow] Orchestra resume failed for task ${taskId}, falling back to direct advance`,
              );
            });

          const { WorkflowOrchestrator } =
            await import('../../services/workflow/workflow-orchestrator');
          const orchestrator = WorkflowOrchestrator.getInstance();
          // Start implementation phase asynchronously (fire-and-forget)
          orchestrator
            .advanceWorkflow(taskId)
            .then((result) => {
              log.info(
                `[Workflow] Auto-advance after approval for task ${taskId}: ${result.success ? 'success' : result.error}`,
              );
            })
            .catch((err) => {
              log.error(
                { err: err },
                `[Workflow] Auto-advance after approval failed for task ${taskId}`,
              );
            });
        } catch (err) {
          log.error({ err: err }, '[Workflow] Failed to auto-advance after approval');
        }
      }

      return {
        success: true,
        task: updatedTask,
        workflowStatus: newStatus,
        autoAdvance: parsedBody.approved,
      };
    } catch (err) {
      if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
      log.error({ err: err }, 'Error approving plan');
      throw err;
    }
  })

  // Update workflow status
  .put('/tasks/:taskId/status', async ({ params, body, set }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');

      const parsedBody = body as { status: string };
      if (
        !parsedBody?.status ||
        !(VALID_WORKFLOW_STATUSES as readonly string[]).includes(parsedBody.status)
      ) {
        throw new ValidationError(
          `Invalid status. Must be one of: ${VALID_WORKFLOW_STATUSES.join(', ')}`,
        );
      }

      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) {
        throw new NotFoundError('Task not found');
      }

      const updatedTask = await prisma.task.update({
        where: { id: taskId },
        data: { workflowStatus: parsedBody.status, updatedAt: new Date() },
      });

      // Record in ActivityLog
      await prisma.activityLog.create({
        data: {
          taskId,
          action: 'workflow_status_updated',
          metadata: JSON.stringify({
            previousStatus: task.workflowStatus,
            newStatus: parsedBody.status,
          }),
          createdAt: new Date(),
        },
      });

      return {
        success: true,
        task: updatedTask,
        workflowStatus: parsedBody.status,
      };
    } catch (err) {
      if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
      log.error({ err: err }, 'Error updating workflow status');
      throw err;
    }
  })

  // Advance to the next workflow phase
  .post('/workflow/tasks/:taskId/advance', async ({ params, set }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');

      const { WorkflowOrchestrator } =
        await import('../../services/workflow/workflow-orchestrator');
      const orchestrator = WorkflowOrchestrator.getInstance();

      // Start async execution (return response without waiting for result)
      const resultPromise = orchestrator.advanceWorkflow(taskId);

      // Return synchronous error for immediate failures (validation errors, etc.)
      // Wait 100ms and check if any errors occurred
      const quickResult = await Promise.race([
        resultPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
      ]);

      if (quickResult !== null) {
        // Immediate completion (API agent) or validation error
        if (!quickResult.success) {
          set.status = 400;
        }
        return quickResult;
      }

      // Continue long-running executions like CLI agents in the background
      resultPromise
        .then(async (result) => {
          log.info(
            `[Workflow] Advance completed for task ${taskId}: ${result.success ? 'success' : result.error}`,
          );
        })
        .catch((err) => {
          log.error({ err: err }, `[Workflow] Advance failed for task ${taskId}`);
        });

      return {
        success: true,
        message: 'Workflow phase execution started',
        taskId,
        async: true,
      };
    } catch (err) {
      if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
      log.error({ err: err }, 'Error advancing workflow');
      throw err;
    }
  })

  // Manual workflow mode setting
  .post('/tasks/:taskId/set-mode', async ({ params, body, set }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');

      const parsedBody = body as {
        mode: 'lightweight' | 'standard' | 'comprehensive';
        override?: boolean;
      };
      const validModes = ['lightweight', 'standard', 'comprehensive'];

      if (!parsedBody?.mode || !validModes.includes(parsedBody.mode)) {
        throw new ValidationError(`Invalid mode. Must be one of: ${validModes.join(', ')}`);
      }

      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) {
        throw new NotFoundError('Task not found');
      }

      const updatedTask = await prisma.task.update({
        where: { id: taskId },
        data: {
          workflowMode: parsedBody.mode,
          workflowModeOverride: parsedBody.override ?? true,
          updatedAt: new Date(),
        },
      });

      // Record in ActivityLog
      await prisma.activityLog.create({
        data: {
          taskId,
          action: 'workflow_mode_changed',
          metadata: JSON.stringify({
            previousMode: task.workflowMode,
            newMode: parsedBody.mode,
            isOverride: parsedBody.override ?? true,
          }),
          createdAt: new Date(),
        },
      });

      return {
        success: true,
        taskId,
        workflowMode: parsedBody.mode,
        override: parsedBody.override ?? true,
        task: updatedTask,
      };
    } catch (err) {
      if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
      log.error({ err: err }, 'Error setting workflow mode');
      throw err;
    }
  })

  // Automatic task complexity analysis
  .get('/tasks/:taskId/analyze-complexity', async ({ params, set }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');

      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          theme: true,
          taskLabels: {
            include: { label: true },
          },
        },
      });

      if (!task) {
        throw new NotFoundError('Task not found');
      }

      // Build TaskComplexityInput
      const complexityInput: TaskComplexityInput = {
        title: task.title,
        description: task.description,
        estimatedHours: task.estimatedHours,
        labels: task.taskLabels.map((tl) => tl.label.name),
        priority: task.priority,
        themeId: task.themeId,
      };

      // Run complexity analysis with learning data
      const analysisResult = await analyzeTaskComplexityWithLearning(complexityInput);

      // Save results to DB (complexity score and workflow mode)
      const updatedTask = await prisma.task.update({
        where: { id: taskId },
        data: {
          complexityScore: analysisResult.complexityScore,
          workflowMode: task.workflowModeOverride
            ? task.workflowMode
            : analysisResult.recommendedMode,
          updatedAt: new Date(),
        },
      });

      return {
        success: true,
        taskId,
        analysis: analysisResult,
        appliedMode: updatedTask.workflowMode,
        wasOverridden: !!task.workflowModeOverride,
        learningInsight: analysisResult.learningInsight || null,
      };
    } catch (err) {
      if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
      log.error({ err: err }, 'Error analyzing task complexity');
      throw err;
    }
  })

  // Get available workflow modes
  .get('/modes', async ({ set }) => {
    try {
      const modeConfig = getWorkflowModeConfig();

      return {
        success: true,
        modes: modeConfig,
        defaultMode: 'comprehensive',
      };
    } catch (err) {
      log.error({ err: err }, 'Error fetching workflow modes');
      throw err;
    }
  });
