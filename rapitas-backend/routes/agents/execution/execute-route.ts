/**
 * execution/execute-route
 *
 * POST /tasks/:id/execute — validates the task, acquires an execution lock,
 * delegates DB/worktree setup to execute-setup.ts, launches the agent worker
 * asynchronously, and returns immediately with the new session ID.
 *
 * Related modules:
 * - execute-setup.ts         DB and worktree setup
 * - execute-post-handler.ts  Async result handling (task/session status, code review)
 * - instruction-builder.ts   Full instruction string assembly
 */

import { Elysia, t } from 'elysia';
import { join } from 'path';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { getProjectRoot } from '../../../config';
import { AgentWorkerManager } from '../../../services/agents/agent-worker-manager';
import { analyzeTaskComplexity } from '../../../services/workflow/complexity-analyzer';
import { agentRateLimiter } from '../../../middleware/rate-limiter';
import { acquireTaskExecutionLock, releaseTaskExecutionLock } from './execution-lock';
import { handleExecuteResult } from './execute-post-handler';
import { buildFullInstruction, fetchAnalysisInfo } from './instruction-builder';
import { executeSetup } from './execute-setup';
import type { AttachmentDescriptor } from './instruction-builder';

const log = createLogger('routes:agent-execution:execute');
const agentWorkerManager = AgentWorkerManager.getInstance();

export const executeRoute = new Elysia().post(
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
      attachments?: AttachmentDescriptor[];
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
        include: { developerModeConfig: true, theme: true },
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
      return { error: 'This task is already running. Please try again after completion.' };
    }
    log.info(`[API] Execution lock acquired for task ${taskIdNum}`);

    const earlyReturn = (response: Record<string, unknown>) => {
      releaseTaskExecutionLock(taskIdNum);
      return response;
    };

    // Auto-analyze complexity if not yet scored
    if (task.complexityScore === null && !task.workflowModeOverride) {
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
      } catch (error) {
        log.error({ err: error }, `[API] Failed to analyze task complexity for task ${taskIdNum}`);
      }
    }

    if (!task.theme?.isDevelopment && !workingDirectory) {
      context.set.status = 400;
      return earlyReturn({
        error:
          'Only tasks belonging to themes set in development projects can be executed. Please check theme settings.',
      });
    }

    // CRITICAL: Require explicit workingDirectory to prevent accidental modification of rapitas source
    const workDir = workingDirectory || task.theme?.workingDirectory;
    if (!workDir) {
      context.set.status = 400;
      return earlyReturn({
        error:
          'Task theme must have workingDirectory configured. Please set the working directory in theme settings to prevent accidental modification of rapitas source code.',
      });
    }

    // NOTE: Log warning when workingDirectory overlaps with rapitas project — allowed but flagged
    const projectRoot = getProjectRoot();
    if (workDir === projectRoot || workDir.startsWith(join(projectRoot, 'rapitas-'))) {
      log.warn(
        `[API] Task ${taskIdNum}: workingDirectory overlaps with rapitas project (${workDir}). Proceeding as user-intended.`,
      );
    }

    log.info(`[API] Executing task ${taskIdNum} in working directory: ${workDir}`);

    let setupResult;
    try {
      setupResult = await executeSetup({
        taskIdNum,
        taskTitle: task.title,
        taskThemeRepositoryUrl: task.theme?.repositoryUrl,
        taskStartedAt: task.startedAt,
        existingConfig: task.developerModeConfig,
        sessionId,
        branchName,
        workDir,
      });
    } catch (setupError) {
      const prismaCode = (setupError as Record<string, unknown>)?.code;
      if (prismaCode) {
        context.set.status = 500;
        return earlyReturn({
          error: 'Database query error occurred',
          code: prismaCode,
          details: setupError instanceof Error ? setupError.message : String(setupError),
        });
      }
      // Worktree creation failure
      return earlyReturn({ error: 'Failed to create worktree', branchName });
    }

    const { developerModeConfig, session, worktreePath } = setupResult;

    const fullInstruction = buildFullInstruction({
      taskTitle: task.title,
      taskDescription: task.description,
      instruction,
      optimizedPrompt,
      attachments,
      workingDirectory: worktreePath,
    });

    const analysisInfo =
      useTaskAnalysis && developerModeConfig
        ? await fetchAnalysisInfo(developerModeConfig.id)
        : undefined;

    const executionDir = worktreePath;

    // NOTE: Execute in worktree directory for git isolation
    agentWorkerManager
      .executeTask(
        {
          id: taskIdNum,
          title: task.title,
          description: fullInstruction,
          context: task.executionInstructions || undefined,
          workingDirectory: executionDir,
          autoApprovePlan: task.autoApprovePlan || false,
        },
        {
          taskId: taskIdNum,
          sessionId: session.id,
          agentConfigId,
          workingDirectory: executionDir,
          timeout,
          analysisInfo,
        },
      )
      .then((result) =>
        handleExecuteResult({
          result,
          taskIdNum,
          sessionId: session.id,
          configId: developerModeConfig.id,
          taskTitle: task.title,
          workDir,
          executionDir,
          branchName,
        }),
      )
      .catch(async (error) => {
        log.error({ err: error }, `[API] Execution error for task ${taskIdNum}`);
        await prisma.task
          .update({ where: { id: taskIdNum }, data: { status: 'todo' } })
          .catch(() => {});
        await prisma.agentSession
          .update({
            where: { id: session.id },
            data: {
              status: 'failed',
              completedAt: new Date(),
              errorMessage: error.message || 'Execution error',
            },
          })
          .catch(() => {});
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
);
