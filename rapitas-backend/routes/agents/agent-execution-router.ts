/**
 * Agent Execution Router
 */
import { Elysia, t } from 'elysia';
import { join } from 'path';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { getProjectRoot } from '../../config';
import { orchestrator } from '../../services/orchestrator-instance';
import { AgentWorkerManager } from '../../services/agents/agent-worker-manager';
import { toJsonString, fromJsonString } from '../../utils/db-helpers';
import {
  cleanImplementationSummary,
  sanitizeScreenshots,
} from '../../utils/agent-response-cleaner';
import { captureScreenshotsForDiff } from '../../services/screenshot-service';
import { generateBranchName } from '../../utils/branch-name-generator';
import type { AgentExecutionWithExtras } from '../../types/agent-execution-types';
import type { ScreenshotResult } from '../../services/screenshot-service';
import { analyzeTaskComplexity } from '../../services/workflow/complexity-analyzer';
import { agentRateLimiter } from '../../middleware/rate-limiter';

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const log = createLogger('routes:agent-execution');

const agentWorkerManager = AgentWorkerManager.getInstance();

/**
 * Task execution in-memory lock
 */
const taskExecutionLocks = new Map<number, { lockedAt: Date; sessionId?: number }>();

function acquireTaskExecutionLock(taskId: number): boolean {
  if (taskExecutionLocks.has(taskId)) {
    const lock = taskExecutionLocks.get(taskId)!;
    const elapsed = Date.now() - lock.lockedAt.getTime();
    if (elapsed < 10 * 60 * 1000) {
      return false;
    }
    log.warn(`[ExecutionLock] Stale lock released for task ${taskId} (elapsed: ${elapsed}ms)`);
  }
  taskExecutionLocks.set(taskId, { lockedAt: new Date() });
  return true;
}

function releaseTaskExecutionLock(taskId: number): void {
  taskExecutionLocks.delete(taskId);
  log.info(`[ExecutionLock] Lock released for task ${taskId}`);
}

/**
 * Helper function for updating session status with retry logic
 * @param sessionId - Session ID
 * @param status - Status to update to
 * @param logPrefix - Log prefix
 * @param maxRetries - Maximum retry count (default 3)
 */
async function updateSessionStatusWithRetry(
  sessionId: number,
  status: 'completed' | 'failed',
  logPrefix: string = '',
  maxRetries: number = 3,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.agentSession.update({
        where: { id: sessionId },
        data: {
          status,
          completedAt: new Date(),
          ...(status === 'failed' && { errorMessage: 'Execution failed' }),
        },
      });

      if (attempt > 1) {
        log.info(
          `${logPrefix} Session ${sessionId} status updated to ${status} on attempt ${attempt}`,
        );
      }
      return;
    } catch (error) {
      lastError = error;
      log.warn(
        { err: error },
        `${logPrefix} Failed to update session ${sessionId} status (attempt ${attempt}/${maxRetries})`,
      );

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  log.error(
    { err: lastError },
    `${logPrefix} Failed to update session ${sessionId} status after ${maxRetries} attempts`,
  );
}

/**
 * Create code review approval request after execution completion (autoApprove support)
 * Common logic called from both normal and continued execution
 */
async function createCodeReviewApproval(params: {
  taskId: number;
  taskTitle: string;
  configId: number;
  sessionId: number;
  workDir: string;
  branchName?: string;
  resultOutput?: string;
  executionTimeMs?: number;
  logPrefix: string;
}): Promise<void> {
  const {
    taskId,
    taskTitle,
    configId,
    sessionId,
    workDir,
    branchName,
    resultOutput,
    executionTimeMs,
    logPrefix,
  } = params;

  try {
    const diff = await agentWorkerManager.getFullGitDiff(workDir);
    const structuredDiff = await agentWorkerManager.getDiff(workDir);

    if (diff && diff !== 'No changes detected') {
      const implementationSummary = cleanImplementationSummary(
        resultOutput || 'Implementation completed.',
      );

      let screenshots: ScreenshotResult[] = [];
      try {
        screenshots = await captureScreenshotsForDiff(structuredDiff, {
          workingDirectory: workDir,
          agentOutput: resultOutput || '',
        });
        if (screenshots.length > 0) {
          log.info(
            `${logPrefix} Captured ${screenshots.length} screenshots for task ${taskId}: ${screenshots.map((s) => s.page).join(', ')}`,
          );
        }
      } catch (screenshotErr) {
        log.warn({ err: screenshotErr }, `${logPrefix} Screenshot capture failed (non-fatal)`);
      }

      const screenshotData = sanitizeScreenshots(screenshots);

      const devConfig = await prisma.developerModeConfig.findUnique({
        where: { id: configId },
        select: { autoApprove: true },
      });
      const isAutoApprove = devConfig?.autoApprove === true;

      try {
        const approvalRequest = await prisma.approvalRequest.create({
          data: {
            configId,
            requestType: 'code_review',
            title: `Code review for "${taskTitle}"`,
            description: implementationSummary,
            status: isAutoApprove ? 'approved' : 'pending',
            proposedChanges:
              toJsonString({
                taskId,
                sessionId,
                workingDirectory: workDir,
                branchName,
                structuredDiff,
                implementationSummary,
                executionTimeMs,
                screenshots: screenshotData,
              }) ?? '',
            executionType: 'code_review',
            estimatedChanges: toJsonString({
              filesChanged: structuredDiff.length,
              summary: implementationSummary.substring(0, 500),
            }),
            ...(isAutoApprove && { approvedAt: new Date() }),
          },
        });

        if (isAutoApprove) {
          log.info(
            `${logPrefix} Auto-approved code review for task ${taskId} (approval #${approvalRequest.id})`,
          );
        } else {
          log.info(
            `${logPrefix} Created code review approval #${approvalRequest.id} for task ${taskId}`,
          );
        }
      } catch (approvalError) {
        log.error(
          { err: approvalError },
          `${logPrefix} Failed to create approval request for task ${taskId}`,
        );
      }
    }
  } catch (diffError) {
    log.error({ err: diffError }, `${logPrefix} Failed to get diff for task ${taskId}`);
  }
}

export const agentExecutionRouter = new Elysia()
  // Execute agent on task
  .post(
    '/tasks/:id/execute',
    async (context) => {
      const ip = context.headers?.['x-forwarded-for'] || 'local';
      if (
        !agentRateLimiter(
          context.set as { status?: number | string; headers: Record<string, string> },
          ip,
        )
      ) {
        return { error: 'Too many requests. Please try again later.' };
      }
      const params = context.params as { id: string };
      const body = context.body as {
        agentConfigId?: number;
        workingDirectory?: string;
        timeout?: number;
        instruction?: string;
        branchName?: string;
        useTaskAnalysis?: boolean;
        optimizedPrompt?: string;
        sessionId?: number;
        attachments?: Array<{
          id: number;
          title: string;
          type: string;
          fileName?: string;
          filePath?: string;
          mimeType?: string;
          description?: string;
        }>;
      };
      const { id } = params;
      const taskIdNum = parseInt(id);
      const {
        agentConfigId,
        workingDirectory,
        timeout,
        instruction,
        branchName,
        useTaskAnalysis,
        optimizedPrompt,
        sessionId,
        attachments,
      } = body;

      let task;
      try {
        task = await prisma.task.findUnique({
          where: { id: taskIdNum },
          include: {
            developerModeConfig: true,
            theme: true,
          },
        });
      } catch (dbError) {
        const prismaCode = (dbError as Record<string, unknown>)?.code;
        log.error({ err: dbError, prismaCode }, `[API] Database error fetching task ${taskIdNum}`);
        context.set.status = 500;
        return {
          error: 'Database query error occurred',
          code: prismaCode || undefined,
          details: dbError instanceof Error ? dbError.message : String(dbError),
        };
      }

      if (!task) {
        context.set.status = 404;
        return { error: 'Task not found' };
      }

      if (!acquireTaskExecutionLock(taskIdNum)) {
        log.warn(`[API] Duplicate execution rejected for task ${taskIdNum}: in-memory lock held`);
        context.set.status = 409;
        return {
          error: 'This task is already running. Please try again after completion.',
        };
      }
      const lockAcquired = true;
      log.info(`[API] Execution lock acquired for task ${taskIdNum}`);

      const earlyReturnWithLockRelease = (response: Record<string, unknown>) => {
        if (lockAcquired) releaseTaskExecutionLock(taskIdNum);
        return response;
      };

      if (task.complexityScore === null && !task.workflowModeOverride) {
        log.info(`[API] Auto-analyzing task complexity for task ${taskIdNum}`);
        try {
          const complexityInput = {
            title: task.title,
            description: task.description,
            estimatedHours: task.estimatedHours,
            labels: task.labels ? JSON.parse(task.labels) : [],
            priority: task.priority,
            themeId: task.themeId,
          };

          const analysisResult = analyzeTaskComplexity(complexityInput);

          await prisma.task.update({
            where: { id: taskIdNum },
            data: {
              complexityScore: analysisResult.complexityScore,
              workflowMode: analysisResult.recommendedMode,
            },
          });

          task.complexityScore = analysisResult.complexityScore;
          task.workflowMode = analysisResult.recommendedMode;

          log.info(
            `[API] Task ${taskIdNum} complexity auto-evaluated: score=${analysisResult.complexityScore}, mode=${analysisResult.recommendedMode}`,
          );
        } catch (error) {
          log.error(
            { err: error },
            `[API] Failed to analyze task complexity for task ${taskIdNum}`,
          );
        }
      } else if (task.workflowModeOverride) {
        log.info(
          `[API] Task ${taskIdNum} has workflow mode override, skipping auto-complexity analysis`,
        );
      } else if (task.complexityScore !== null) {
        log.info(
          `[API] Task ${taskIdNum} already has complexity score: ${task.complexityScore}, skipping analysis`,
        );
      }

      if (!task.theme?.isDevelopment && !workingDirectory) {
        log.error(
          `[API] Task ${taskIdNum} rejected: not in a development theme and no workingDirectory specified.`,
        );
        context.set.status = 400;
        return earlyReturnWithLockRelease({
          error:
            'Only tasks belonging to themes set in development projects can be executed. Please check theme settings.',
        });
      }

      const workDir = workingDirectory || task.theme?.workingDirectory || getProjectRoot();

      let developerModeConfig = task.developerModeConfig;
      let session;
      let finalBranchName = branchName;

      try {
        if (!developerModeConfig) {
          developerModeConfig = await prisma.developerModeConfig.upsert({
            where: { taskId: taskIdNum },
            update: {},
            create: {
              taskId: taskIdNum,
              isEnabled: true,
            },
          });
        }

        if (sessionId) {
          const existingSession = await prisma.agentSession.findUnique({
            where: { id: sessionId },
          });
          if (!existingSession) {
            context.set.status = 404;
            return earlyReturnWithLockRelease({ error: 'Session not found' });
          }
          if (existingSession.configId !== developerModeConfig.id) {
            context.set.status = 400;
            return earlyReturnWithLockRelease({ error: 'Session does not belong to this task' });
          }
          session = existingSession;
          log.info(`[API] Continuing execution with existing session ${sessionId}`);
        } else {
          session = await prisma.agentSession.create({
            data: {
              configId: developerModeConfig.id,
              status: 'pending',
            },
          });
          log.info(`[API] Created new session ${session.id}`);
        }

        if (!finalBranchName) {
          try {
            finalBranchName = await generateBranchName(task.title, task.description || undefined);
            log.info(`[API] Generated branch name: ${finalBranchName} for task ${taskIdNum}`);
          } catch (error) {
            log.error({ err: error }, `[API] Branch name generation failed for task ${taskIdNum}`);
            finalBranchName = `feature/task-${taskIdNum}-auto-generated`;
          }
        }

        const branchCreated = await agentWorkerManager.createBranch(workDir, finalBranchName);
        if (!branchCreated) {
          return earlyReturnWithLockRelease({
            error: 'Failed to create branch',
            branchName: finalBranchName,
          });
        }

        session = await prisma.agentSession.update({
          where: { id: session.id },
          data: { branchName: finalBranchName },
        });

        await prisma.notification.create({
          data: {
            type: 'agent_execution_started',
            title: 'Agent execution started',
            message: `Started automatic execution of "${task.title}"`,
            link: `/tasks/${taskIdNum}`,
            metadata: toJsonString({ sessionId: session.id, taskId: taskIdNum }),
          },
        });

        await prisma.task.update({
          where: { id: taskIdNum },
          data: {
            status: 'in-progress',
            startedAt: task.startedAt || new Date(),
          },
        });
        log.info(`[API] Updated task ${taskIdNum} status to 'in-progress'`);
      } catch (dbError) {
        const prismaCode = (dbError as Record<string, unknown>)?.code;
        log.error(
          { err: dbError, prismaCode },
          `[API] Database error during execution setup for task ${taskIdNum}`,
        );
        context.set.status = 500;
        return earlyReturnWithLockRelease({
          error: 'Database query error occurred',
          code: prismaCode || undefined,
          details: dbError instanceof Error ? dbError.message : String(dbError),
        });
      }

      let fullInstruction: string;
      if (optimizedPrompt) {
        fullInstruction = instruction
          ? `${optimizedPrompt}\n\nAdditional instructions:\n${instruction}`
          : optimizedPrompt;
        log.info(`[API] Using optimized prompt for task ${taskIdNum}`);
      } else {
        fullInstruction = instruction
          ? `${task.description || task.title}\n\nAdditional instructions:\n${instruction}`
          : task.description || task.title;
      }

      if (attachments && attachments.length > 0) {
        const attachmentInfo = attachments
          .map((a) => {
            let info = `- ${a.title} (${a.type})`;
            if (a.fileName) info += ` - File name: ${a.fileName}`;
            if (a.description) info += ` - Description: ${a.description}`;
            if (a.filePath) {
              const fullPath = join(UPLOAD_DIR, a.filePath);
              info += `\n  Path: ${fullPath}`;
            }
            return info;
          })
          .join('\n');
        fullInstruction += `\n\n## Attached Files\nThe following files are attached to this task. Please refer to them as needed:\n${attachmentInfo}`;
        log.info(`[API] Added ${attachments.length} attachments to instruction`);
      }

      let analysisInfo:
        | {
            summary: string;
            complexity: 'simple' | 'medium' | 'complex';
            estimatedTotalHours: number;
            subtasks: Array<{
              title: string;
              description: string;
              estimatedHours: number;
              priority: 'low' | 'medium' | 'high' | 'urgent';
              order: number;
              dependencies?: number[];
            }>;
            reasoning: string;
            tips?: string[];
          }
        | undefined;

      if (useTaskAnalysis && developerModeConfig) {
        try {
          const latestAnalysisAction = await prisma.agentAction.findFirst({
            where: {
              session: {
                configId: developerModeConfig.id,
              },
              actionType: 'analysis',
              status: 'success',
            },
            orderBy: {
              createdAt: 'desc',
            },
          });

          if (latestAnalysisAction?.output) {
            try {
              const analysisOutput = fromJsonString<Record<string, unknown>>(
                latestAnalysisAction.output,
              );
              if (analysisOutput?.summary && analysisOutput?.suggestedSubtasks) {
                analysisInfo = {
                  summary: analysisOutput.summary as string,
                  complexity:
                    (analysisOutput.complexity as 'simple' | 'medium' | 'complex') || 'medium',
                  estimatedTotalHours: (analysisOutput.estimatedTotalHours as number) || 0,
                  subtasks: (
                    (analysisOutput.suggestedSubtasks as Array<{
                      title: string;
                      description?: string;
                      estimatedHours?: number;
                      priority?: string;
                      order?: number;
                      dependencies?: number[];
                    }>) || []
                  ).map((st) => ({
                    title: st.title,
                    description: st.description || '',
                    estimatedHours: st.estimatedHours || 0,
                    priority: (st.priority as 'low' | 'medium' | 'high' | 'urgent') || 'medium',
                    order: st.order || 0,
                    dependencies: st.dependencies,
                  })),
                  reasoning: (analysisOutput.reasoning as string) || '',
                  tips: analysisOutput.tips as string[] | undefined,
                };
                log.info(`[API] Using AI task analysis for task ${taskIdNum}`);
                log.info(`[API] Analysis subtasks count: ${analysisInfo!.subtasks.length}`);
              }
            } catch (e) {
              log.error({ err: e }, `[API] Failed to parse analysis result`);
            }
          } else {
            log.info(`[API] No analysis result found for task ${taskIdNum}`);
          }
        } catch (dbError) {
          log.error(
            { err: dbError },
            `[API] Failed to fetch analysis action for task ${taskIdNum}`,
          );
        }
      }

      // Execute Claude Code asynchronously (via worker)
      agentWorkerManager
        .executeTask(
          {
            id: taskIdNum,
            title: task.title,
            description: fullInstruction,
            context: task.executionInstructions || undefined,
            workingDirectory: workDir,
          },
          {
            taskId: taskIdNum,
            sessionId: session.id,
            agentConfigId,
            workingDirectory: workDir,
            timeout,
            analysisInfo,
          },
        )
        .then(async (result) => {
          if (result.waitingForInput) {
            log.info(
              `[API] Task ${taskIdNum} is waiting for user input, keeping status as 'in_progress'`,
            );
            await prisma.task
              .update({
                where: { id: taskIdNum },
                data: { status: 'in_progress' },
              })
              .catch((e: unknown) => {
                log.error(
                  { err: e },
                  `[API] Failed to update task ${taskIdNum} status to in_progress`,
                );
              });

            await prisma.agentSession
              .update({
                where: { id: session.id },
                data: {
                  status: 'running',
                  lastActivityAt: new Date(),
                },
              })
              .catch((e: unknown) => {
                log.error(
                  { err: e },
                  `[API] Failed to update session ${session.id} status to running`,
                );
              });
          } else if (result.success) {
            try {
              const currentTask = await prisma.task.findUnique({
                where: { id: taskIdNum },
              });
              const wfStatus = currentTask?.workflowStatus;
              if (
                wfStatus === 'plan_created' ||
                wfStatus === 'research_done' ||
                wfStatus === 'verify_done'
              ) {
                try {
                  await prisma.task.update({
                    where: { id: taskIdNum },
                    data: { status: 'in-progress' },
                  });
                  log.info(`[API] Task ${taskIdNum} kept as in-progress (workflow: ${wfStatus})`);
                } catch (updateError) {
                  log.error(
                    { err: updateError },
                    `[API] Failed to update task ${taskIdNum} status to in-progress`,
                  );
                }
              } else if (
                wfStatus === 'in_progress' ||
                wfStatus === 'plan_approved' ||
                wfStatus === 'completed'
              ) {
                try {
                  await prisma.task.update({
                    where: { id: taskIdNum },
                    data: { status: 'done', completedAt: new Date() },
                  });
                  log.info(
                    `[API] Updated task ${taskIdNum} status to 'done' (workflow: ${wfStatus})`,
                  );
                } catch (updateError) {
                  log.error(
                    { err: updateError },
                    `[API] Failed to update task ${taskIdNum} status to done`,
                  );
                }
              } else if (!wfStatus || wfStatus === 'draft') {
                try {
                  await prisma.task.update({
                    where: { id: taskIdNum },
                    data: { status: 'done', completedAt: new Date() },
                  });
                  log.info(`[API] Updated task ${taskIdNum} status to 'done'`);
                } catch (updateError) {
                  log.error(
                    { err: updateError },
                    `[API] Failed to update task ${taskIdNum} status to done`,
                  );
                }
              } else {
                log.info(
                  `[API] Task ${taskIdNum} kept as in-progress (unknown workflow status: ${wfStatus})`,
                );
              }
            } catch (taskError) {
              log.error({ err: taskError }, `[API] Failed to fetch or update task ${taskIdNum}`);
            }

            await updateSessionStatusWithRetry(session.id, 'completed', '[API]', 3);

            await createCodeReviewApproval({
              taskId: taskIdNum,
              taskTitle: task.title,
              configId: developerModeConfig!.id,
              sessionId: session.id,
              workDir,
              branchName,
              resultOutput: result.output,
              executionTimeMs: result.executionTimeMs,
              logPrefix: '[API]',
            });
          } else {
            log.error(
              { errorMessage: result.errorMessage },
              `[API] Execution failed for task ${taskIdNum}`,
            );
            try {
              await prisma.task.update({
                where: { id: taskIdNum },
                data: { status: 'todo' },
              });
            } catch (updateError) {
              log.error(
                { err: updateError },
                `[API] Failed to update task ${taskIdNum} status to todo after execution failure`,
              );
            }

            await prisma.agentSession
              .update({
                where: { id: session.id },
                data: {
                  status: 'failed',
                  completedAt: new Date(),
                  errorMessage: result.errorMessage || 'Execution failed',
                },
              })
              .catch((e: unknown) => {
                log.error(
                  { err: e },
                  `[API] Failed to update session ${session.id} status to failed`,
                );
              });
          }
        })
        .catch(async (error) => {
          log.error({ err: error }, `[API] Execution error for task ${taskIdNum}`);
          await prisma.task.update({
            where: { id: taskIdNum },
            data: { status: 'todo' },
          });

          await prisma.agentSession
            .update({
              where: { id: session.id },
              data: {
                status: 'failed',
                completedAt: new Date(),
                errorMessage: error.message || 'Execution error',
              },
            })
            .catch((e: unknown) => {
              log.error(
                { err: e },
                `[API] Failed to update session ${session.id} status to failed`,
              );
            });
        })
        .finally(() => {
          releaseTaskExecutionLock(taskIdNum);
        });

      return {
        success: true,
        message: 'Task execution started',
        sessionId: session.id,
        taskId: taskIdNum,
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Get task execution status
  .get(
    '/tasks/:id/execution-status',
    async (context) => {
      const { params } = context;
      try {
        const taskId = parseInt(params.id);

        const config = await prisma.developerModeConfig.findUnique({
          where: { taskId },
          include: {
            agentSessions: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: {
                agentExecutions: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  include: {
                    agentConfig: {
                      select: {
                        id: true,
                        agentType: true,
                        name: true,
                        modelId: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

        if (!config || !config.agentSessions[0]) {
          return { status: 'none', message: 'No execution history' };
        }

        const latestSession = config.agentSessions[0];
        const latestExecution = latestSession.agentExecutions[0];
        const execExtras = latestExecution as typeof latestExecution & AgentExecutionWithExtras;

        // NOTE: For new executions, the query returns a new session (no execution), so the old completed state does not appear.
        // For continued executions (same session), the frontend absorbs this with terminalGraceMs.
        // No backend guard is added here, as checking worker IPC timing could interfere with completion detection.

        const isWaitingForInput = latestExecution?.status === 'waiting_for_input';
        const questionText = execExtras?.question || null;
        const questionType: 'tool_call' | 'none' =
          execExtras?.questionType === 'tool_call' ? 'tool_call' : 'none';

        let questionTimeoutInfo = null;
        if (isWaitingForInput && latestExecution?.id) {
          const timeoutInfo = await agentWorkerManager.getQuestionTimeoutInfoAsync(
            latestExecution.id,
          );
          if (timeoutInfo) {
            questionTimeoutInfo = {
              remainingSeconds: timeoutInfo.remainingSeconds,
              deadline: timeoutInfo.deadline.toISOString(),
              totalSeconds: timeoutInfo.questionKey?.timeout_seconds || 300,
            };
          }
        }

        const agentConfigInfo = (latestExecution as Record<string, unknown>)?.agentConfig as {
          id: number;
          agentType: string;
          name: string;
          modelId: string | null;
        } | null;

        return {
          sessionId: latestSession.id,
          sessionStatus: latestSession.status,
          sessionMode: latestSession.mode || null,
          executionId: latestExecution?.id,
          executionStatus: latestExecution?.status,
          output: latestExecution?.output,
          errorMessage: latestExecution?.errorMessage,
          startedAt: latestExecution?.startedAt,
          completedAt: latestExecution?.completedAt,
          tokensUsed: latestExecution?.tokensUsed || 0,
          totalSessionTokens: latestSession.totalTokensUsed || 0,
          waitingForInput: isWaitingForInput,
          question: questionText,
          questionType,
          questionTimeout: questionTimeoutInfo,
          claudeSessionId: execExtras?.claudeSessionId || null,
          agentConfig: agentConfigInfo || null,
        };
      } catch (error) {
        log.error({ err: error }, '[execution-status] Error fetching status');
        return {
          status: 'error',
          message: 'An error occurred while retrieving status',
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Respond to agent (answer question)
  .post(
    '/tasks/:id/agent-respond',
    async (context) => {
      const params = context.params as { id: string };
      const body = context.body as { response: string };
      const taskId = parseInt(params.id);
      const { response } = body;

      if (!response?.trim()) {
        return { error: 'Response is required' };
      }

      try {
        const config = await prisma.developerModeConfig.findUnique({
          where: { taskId },
          include: {
            task: { include: { theme: true } },
            agentSessions: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: {
                agentExecutions: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                },
              },
            },
          },
        });

        if (!config || !config.agentSessions[0]) {
          return { error: 'No active session found' };
        }

        const session = config.agentSessions[0];
        const latestExecution = session.agentExecutions[0];

        if (!latestExecution) {
          return { error: 'No execution found' };
        }

        if (latestExecution.status === 'running') {
          return { error: 'Execution is already running' };
        }
        if (latestExecution.status !== 'waiting_for_input') {
          return {
            error: `Execution is not waiting for input: ${latestExecution.status}`,
          };
        }

        if (
          !(await agentWorkerManager.tryAcquireContinuationLockAsync(
            latestExecution.id,
            'user_response',
          ))
        ) {
          return {
            error: 'Another operation is in progress for this execution',
          };
        }

        agentWorkerManager.cancelQuestionTimeout(latestExecution.id);
        log.info(`[agent-respond] Cancelled timeout for execution ${latestExecution.id}`);

        const workingDirectory = config.task.theme?.workingDirectory || getProjectRoot();

        const result = await agentWorkerManager.executeContinuation(latestExecution.id, response, {
          sessionId: session.id,
          taskId,
          workingDirectory,
        });

        if (result.success) {
          return {
            success: true,
            message: 'Response sent successfully',
            executionId: latestExecution.id,
          };
        } else {
          return {
            error: result.errorMessage || 'Failed to send response',
            executionId: latestExecution.id,
          };
        }
      } catch (error) {
        log.error({ err: error }, '[agent-respond] Database error');
        return {
          error: 'Database error occurred. Failed to send response.',
          message: 'Failed to send agent response due to database error',
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Stop task execution (rollback changes)
  .post(
    '/tasks/:id/stop-execution',
    async (context) => {
      const { params } = context;
      const taskId = parseInt(params.id);

      try {
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          select: { workingDirectory: true },
        });

        const config = await prisma.developerModeConfig.findUnique({
          where: { taskId },
          include: {
            agentSessions: {
              where: {
                status: { in: ['running', 'pending'] },
              },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        });

        if (!config || config.agentSessions.length === 0) {
          const runningExecution = await prisma.agentExecution.findFirst({
            where: {
              session: {
                config: {
                  taskId,
                },
              },
              status: { in: ['running', 'pending', 'waiting_for_input'] },
            },
            orderBy: { createdAt: 'desc' },
          });

          if (runningExecution) {
            const stopped = await orchestrator
              .stopExecution(runningExecution.id)
              .catch(() => false);

            try {
              await prisma.agentExecutionLog.deleteMany({
                where: { executionId: runningExecution.id },
              });
              log.info(
                `[stop-execution] Deleted execution logs for execution ${runningExecution.id}`,
              );
            } catch (deleteError) {
              log.error(
                { err: deleteError },
                `[stop-execution] Failed to delete execution logs for execution ${runningExecution.id}`,
              );
            }

            if (!stopped) {
              try {
                await prisma.agentExecution.update({
                  where: { id: runningExecution.id },
                  data: {
                    status: 'cancelled',
                    completedAt: new Date(),
                    errorMessage: 'Cancelled by user',
                  },
                });
                log.info(
                  `[stop-execution] Updated DB status for execution ${runningExecution.id} (not found in orchestrator)`,
                );
              } catch (updateError) {
                log.error(
                  { err: updateError },
                  `[stop-execution] Failed to update execution ${runningExecution.id} status`,
                );
              }
            }

            if (task?.workingDirectory) {
              try {
                await agentWorkerManager.revertChanges(task.workingDirectory);
                log.info(`[stop-execution] Reverted changes in ${task.workingDirectory}`);
              } catch (revertError) {
                log.error({ err: revertError }, `[stop-execution] Failed to revert changes`);
              }
            }

            return {
              success: true,
              message: 'Execution cancelled and changes reverted',
            };
          }

          return { success: false, message: 'No running execution found' };
        }

        const session = config.agentSessions[0];

        const executions = await agentWorkerManager.getSessionExecutionsAsync(session.id);
        for (const execution of executions) {
          await agentWorkerManager.stopExecution(execution.executionId);
        }

        const pendingExecutions = await prisma.agentExecution.findMany({
          where: {
            sessionId: session.id,
            status: { in: ['running', 'pending', 'waiting_for_input'] },
          },
        });

        for (const execution of pendingExecutions) {
          try {
            await prisma.agentExecutionLog.deleteMany({
              where: { executionId: execution.id },
            });

            await prisma.agentExecution.update({
              where: { id: execution.id },
              data: {
                status: 'cancelled',
                completedAt: new Date(),
                errorMessage: 'Cancelled by user',
              },
            });
          } catch (executionUpdateError) {
            log.error(
              { err: executionUpdateError },
              `[stop-execution] Failed to update execution ${execution.id}`,
            );
          }
        }

        try {
          await prisma.agentSession.update({
            where: { id: session.id },
            data: {
              status: 'failed',
              completedAt: new Date(),
              errorMessage: 'Cancelled by user',
            },
          });
        } catch (sessionUpdateError) {
          log.error(
            { err: sessionUpdateError },
            `[stop-execution] Failed to update session ${session.id} status`,
          );
        }

        if (task?.workingDirectory) {
          try {
            await agentWorkerManager.revertChanges(task.workingDirectory);
            log.info(`[stop-execution] Reverted changes in ${task.workingDirectory}`);
          } catch (revertError) {
            log.error({ err: revertError }, `[stop-execution] Failed to revert changes`);
          }
        }

        releaseTaskExecutionLock(taskId);

        return {
          success: true,
          sessionId: session.id,
          message: 'Execution stopped and changes reverted',
        };
      } catch (error) {
        log.error({ err: error }, '[stop-execution] Database error');
        releaseTaskExecutionLock(taskId);
        return {
          success: false,
          error: 'Database error occurred. Failed to stop execution.',
          message: 'Failed to stop execution due to database error',
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Continue execution with additional instruction
  .post(
    '/tasks/:id/continue-execution',
    async (context) => {
      const taskId = parseInt(context.params.id);
      const { instruction, sessionId, agentConfigId } = context.body as {
        instruction?: string;
        sessionId?: number;
        agentConfigId?: number;
      };

      if (!instruction?.trim()) {
        context.set.status = 400;
        return { error: 'Instruction is required' };
      }

      if (!acquireTaskExecutionLock(taskId)) {
        log.warn(
          `[continue-execution] Duplicate execution rejected for task ${taskId}: in-memory lock held`,
        );
        context.set.status = 409;
        return {
          error: 'This task is already running. Please try again after completion.',
        };
      }
      log.info(`[continue-execution] Execution lock acquired for task ${taskId}`);

      try {
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          include: {
            developerModeConfig: true,
            theme: true,
          },
        });

        if (!task) {
          context.set.status = 404;
          return { error: 'Task not found' };
        }

        // NOTE: Falls back to latest finished session when no sessionId is provided — enables "resume last run" UX.
        let targetSessionId = sessionId;
        if (!targetSessionId && task.developerModeConfig) {
          const latestSession = await prisma.agentSession.findFirst({
            where: {
              configId: task.developerModeConfig.id,
              status: { in: ['completed', 'failed', 'interrupted'] },
            },
            orderBy: { createdAt: 'desc' },
          });

          if (latestSession) {
            targetSessionId = latestSession.id;
          }
        }

        if (!targetSessionId) {
          context.set.status = 404;
          return { error: 'No completed session found for this task' };
        }

        const session = await prisma.agentSession.findUnique({
          where: { id: targetSessionId },
          include: {
            agentExecutions: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        });

        if (!session) {
          context.set.status = 404;
          return { error: 'Session not found' };
        }

        log.info(`[continue-execution] Session ${targetSessionId} status: "${session.status}"`);

        const activeCount = await agentWorkerManager.getActiveExecutionCountAsync();
        const hasRunningExecution = session.agentExecutions.some(
          (e: { status: string }) => e.status === 'running' || e.status === 'pending',
        );
        if (hasRunningExecution && activeCount > 0) {
          context.set.status = 409;
          return { error: 'An execution is already running for this session' };
        }

        const previousExecution = session.agentExecutions[0];
        const workingDirectory = task.theme?.workingDirectory || getProjectRoot();

        if (session.branchName) {
          try {
            const branchCreated = await agentWorkerManager.createBranch(
              workingDirectory,
              session.branchName,
            );
            if (!branchCreated) {
              log.error(
                `[continue-execution] Failed to checkout branch ${session.branchName} for task ${taskId}`,
              );
            } else {
              log.info(
                `[continue-execution] Checked out branch ${session.branchName} for task ${taskId}`,
              );
            }
          } catch (error) {
            log.error(
              { err: error },
              `[continue-execution] Branch checkout error for task ${taskId}`,
            );
          }
        } else {
          log.info(`[continue-execution] No branch name stored in session ${targetSessionId}`);
        }

        try {
          await prisma.agentSession.update({
            where: { id: targetSessionId },
            data: {
              status: 'running',
              lastActivityAt: new Date(),
            },
          });
        } catch (dbError) {
          log.error(
            { err: dbError },
            `[continue-execution] Failed to update session ${targetSessionId} status`,
          );
          // NOTE: Session update failure is non-fatal — execution can proceed with stale status.
        }

        try {
          await prisma.task.update({
            where: { id: taskId },
            data: {
              status: 'in-progress',
            },
          });
        } catch (dbError) {
          log.error(
            { err: dbError },
            `[continue-execution] Failed to update task ${taskId} status`,
          );
          // NOTE: Task status update failure is non-fatal — execution can proceed with stale status.
        }

        log.info(
          `[continue-execution] Continuing execution for task ${taskId} in session ${targetSessionId}`,
        );

        try {
          await prisma.notification.create({
            data: {
              type: 'agent_execution_continued',
              title: 'Additional instruction execution started',
              message: `Executing additional instructions for "${task.title}"`,
              link: `/tasks/${taskId}`,
              metadata: toJsonString({ sessionId: targetSessionId, taskId }),
            },
          });
        } catch (dbError) {
          log.error(
            { err: dbError },
            `[continue-execution] Failed to create notification for task ${taskId}`,
          );
        }

        let fullInstruction = `## Additional Instructions\n\n${instruction}`;

        if (previousExecution?.output) {
          const prevOutput = previousExecution.output.substring(0, 3000);
          fullInstruction = `## Previous Execution Content\n\nThe following work was performed in the previous execution:\n\n${prevOutput}${previousExecution.output.length > 3000 ? '\n...(abbreviated)' : ''}\n\n${fullInstruction}`;
        }

        agentWorkerManager
          .executeTask(
            {
              id: taskId,
              title: task.title,
              description: fullInstruction,
              context: task.executionInstructions || undefined,
              workingDirectory,
            },
            {
              taskId,
              sessionId: targetSessionId,
              agentConfigId: agentConfigId || (previousExecution?.agentConfigId ?? undefined),
              workingDirectory,
              continueFromPrevious: true,
            },
          )
          .then(async (result) => {
            if (result.success) {
              try {
                const currentTask = await prisma.task.findUnique({
                  where: { id: taskId },
                });
                const wfStatus = currentTask?.workflowStatus;
                if (
                  wfStatus &&
                  ['plan_created', 'research_done', 'verify_done'].includes(wfStatus)
                ) {
                  try {
                    await prisma.task.update({
                      where: { id: taskId },
                      data: { status: 'in-progress' },
                    });
                  } catch (updateError) {
                    log.error(
                      { err: updateError },
                      `[continue-execution] Failed to update task ${taskId} status to in-progress`,
                    );
                  }
                } else if (
                  wfStatus === 'in_progress' ||
                  wfStatus === 'plan_approved' ||
                  wfStatus === 'completed'
                ) {
                  try {
                    await prisma.task.update({
                      where: { id: taskId },
                      data: { status: 'done', completedAt: new Date() },
                    });
                  } catch (updateError) {
                    log.error(
                      { err: updateError },
                      `[continue-execution] Failed to update task ${taskId} status to done`,
                    );
                  }
                } else if (!wfStatus || wfStatus === 'draft') {
                  try {
                    await prisma.task.update({
                      where: { id: taskId },
                      data: { status: 'done', completedAt: new Date() },
                    });
                  } catch (updateError) {
                    log.error(
                      { err: updateError },
                      `[continue-execution] Failed to update task ${taskId} status to done`,
                    );
                  }
                }
              } catch (taskError) {
                log.error(
                  { err: taskError },
                  `[continue-execution] Failed to fetch or update task ${taskId}`,
                );
              }

              await updateSessionStatusWithRetry(
                targetSessionId,
                'completed',
                '[continue-execution]',
                3,
              );

              if (task.developerModeConfig) {
                await createCodeReviewApproval({
                  taskId,
                  taskTitle: task.title,
                  configId: task.developerModeConfig.id,
                  sessionId: targetSessionId,
                  workDir: workingDirectory,
                  branchName: session.branchName || undefined,
                  resultOutput: result.output,
                  executionTimeMs: result.executionTimeMs,
                  logPrefix: '[continue-execution]',
                });
              }

              log.info(`[continue-execution] Completed task ${taskId}`);
            } else {
              log.error(
                { errorMessage: result.errorMessage },
                `[continue-execution] Failed for task ${taskId}`,
              );
              try {
                await prisma.task.update({
                  where: { id: taskId },
                  data: { status: 'todo' },
                });
              } catch (updateError) {
                log.error(
                  { err: updateError },
                  `[continue-execution] Failed to update task ${taskId} status to todo after failure`,
                );
              }

              await prisma.agentSession
                .update({
                  where: { id: targetSessionId },
                  data: {
                    status: 'failed',
                    completedAt: new Date(),
                    errorMessage: result.errorMessage || 'Continuation failed',
                  },
                })
                .catch((e: unknown) => {
                  log.error(
                    { err: e },
                    `[continue-execution] Failed to update session ${targetSessionId} status to failed`,
                  );
                });
            }
          })
          .catch(async (error) => {
            log.error({ err: error }, `[continue-execution] Execution error for task ${taskId}`);
            try {
              await prisma.task.update({
                where: { id: taskId },
                data: { status: 'todo' },
              });
            } catch (updateError) {
              log.error(
                { err: updateError },
                `[continue-execution] Failed to update task ${taskId} status to todo after execution error`,
              );
            }

            await prisma.agentSession
              .update({
                where: { id: targetSessionId },
                data: {
                  status: 'failed',
                  completedAt: new Date(),
                  errorMessage: error.message || 'Continuation error',
                },
              })
              .catch((e: unknown) => {
                log.error(
                  { err: e },
                  `[continue-execution] Failed to update session ${targetSessionId} status to failed`,
                );
              });
          })
          .finally(() => {
            releaseTaskExecutionLock(taskId);
          });

        return {
          success: true,
          message: 'Continuation started',
          sessionId: targetSessionId,
          taskId,
        };
      } catch (error) {
        releaseTaskExecutionLock(taskId);
        log.error({ err: error }, `[continue-execution] Error`);
        context.set.status = 500;
        return { error: 'Internal server error' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Reset execution state
  .post(
    '/tasks/:id/reset-execution-state',
    async (context) => {
      const { params } = context;
      const taskId = parseInt(params.id);

      try {
        const config = await prisma.developerModeConfig.findUnique({
          where: { taskId },
          include: {
            agentSessions: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        });

        if (!config) {
          return { error: 'No developer mode config found for this task' };
        }

        if (config.agentSessions.length > 0) {
          const latestSession = config.agentSessions[0];

          if (['running', 'pending'].includes(latestSession.status)) {
            const executions = await agentWorkerManager.getSessionExecutionsAsync(latestSession.id);
            for (const execution of executions) {
              await agentWorkerManager.stopExecution(execution.executionId);
            }

            const pendingExecutions = await prisma.agentExecution.findMany({
              where: {
                sessionId: latestSession.id,
                status: { in: ['running', 'pending', 'waiting_for_input'] },
              },
            });

            for (const execution of pendingExecutions) {
              await prisma.agentExecutionLog.deleteMany({
                where: { executionId: execution.id },
              });

              await prisma.agentExecution.update({
                where: { id: execution.id },
                data: {
                  status: 'cancelled',
                  completedAt: new Date(),
                  errorMessage: 'Reset by user',
                },
              });
            }

            await prisma.agentSession.update({
              where: { id: latestSession.id },
              data: {
                status: 'cancelled',
                completedAt: new Date(),
                errorMessage: 'Reset by user',
              },
            });
          }
        }

        await prisma.task.update({
          where: { id: taskId },
          data: {
            status: 'todo',
            startedAt: null,
            completedAt: null,
          },
        });

        log.info(`[reset-execution-state] Reset execution state for task ${taskId}`);

        releaseTaskExecutionLock(taskId);

        return {
          success: true,
          message: 'Execution state reset successfully',
          taskId,
        };
      } catch (error) {
        log.error({ err: error }, `[reset-execution-state] Error`);
        releaseTaskExecutionLock(taskId);
        return { error: 'Failed to reset execution state' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
