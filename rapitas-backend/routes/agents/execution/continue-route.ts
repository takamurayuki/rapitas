/**
 * execution/continue-route
 *
 * POST /tasks/:id/continue-execution — resumes a completed or failed session
 * with additional instructions. Reuses the existing worktree when available;
 * otherwise creates a new one on the same branch.
 * Post-execution state transitions are handled by continue-post-handler.ts.
 */

import { Elysia, t } from 'elysia';
import { join } from 'path';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { getProjectRoot } from '../../../config';
import { AgentWorkerManager } from '../../../services/agents/agent-worker-manager';
import { toJsonString } from '../../../utils/db-helpers';
import { acquireTaskExecutionLock, releaseTaskExecutionLock } from './execution-lock';
import { handleContinueResult, handleContinueError } from './continue-post-handler';

const log = createLogger('routes:agent-execution:continue');
const agentWorkerManager = AgentWorkerManager.getInstance();

export const continueRoute = new Elysia().post(
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
      log.warn(`[continue-execution] Duplicate execution rejected for task ${taskId}: lock held`);
      context.set.status = 409;
      return { error: 'This task is already running. Please try again after completion.' };
    }
    log.info(`[continue-execution] Execution lock acquired for task ${taskId}`);

    try {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: { developerModeConfig: true, theme: true },
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
        if (latestSession) targetSessionId = latestSession.id;
      }

      if (!targetSessionId) {
        context.set.status = 404;
        return { error: 'No completed session found for this task' };
      }

      const session = await prisma.agentSession.findUnique({
        where: { id: targetSessionId },
        include: { agentExecutions: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });

      if (!session) {
        context.set.status = 404;
        return { error: 'Session not found' };
      }

      const activeCount = await agentWorkerManager.getActiveExecutionCountAsync();
      const hasRunningExecution = session.agentExecutions.some(
        (e: { status: string }) => e.status === 'running' || e.status === 'pending',
      );
      if (hasRunningExecution && activeCount > 0) {
        context.set.status = 409;
        return { error: 'An execution is already running for this session' };
      }

      const previousExecution = session.agentExecutions[0];
      const workingDirectory = task.theme?.workingDirectory;

      // CRITICAL: Require explicit workingDirectory to prevent accidental modification of rapitas source
      if (!workingDirectory) {
        log.error(
          `[continue-execution] Task ${taskId} rejected: workingDirectory not configured.`,
        );
        return {
          error:
            'Task theme must have workingDirectory configured. Please set the working directory in theme settings to prevent accidental modification of rapitas source code.',
        };
      }

      // NOTE: Log warning when workingDirectory overlaps with rapitas project — allowed but flagged
      const projectRoot = getProjectRoot();
      if (
        workingDirectory === projectRoot ||
        workingDirectory.startsWith(join(projectRoot, 'rapitas-'))
      ) {
        log.warn(
          `[continue-execution] Task ${taskId}: workingDirectory overlaps with rapitas project (${workingDirectory}). Proceeding.`,
        );
      }

      log.info(`[continue-execution] Continuing task ${taskId} in: ${workingDirectory}`);

      // NOTE: Reuse existing worktree if available, otherwise create a new one
      let executionDir = (session as Record<string, unknown>).worktreePath as string | null;
      if (executionDir) {
        log.info(`[continue-execution] Reusing existing worktree: ${executionDir}`);
      } else if (session.branchName) {
        try {
          executionDir = await agentWorkerManager.createWorktree(
            workingDirectory,
            session.branchName,
            taskId,
            task.theme?.repositoryUrl || null,
          );
          await prisma.agentSession.update({
            where: { id: targetSessionId },
            data: { worktreePath: executionDir },
          });
        } catch (error) {
          log.error({ err: error }, `[continue-execution] Worktree creation error, falling back`);
          try {
            await agentWorkerManager.createBranch(workingDirectory, session.branchName);
          } catch {
            // NOTE: Branch checkout fallback failure is non-fatal — use working directory directly.
          }
          executionDir = workingDirectory;
        }
      } else {
        executionDir = workingDirectory;
      }

      // NOTE: Session/task update failures are non-fatal — execution proceeds with stale status.
      await prisma.agentSession
        .update({ where: { id: targetSessionId }, data: { status: 'running', lastActivityAt: new Date() } })
        .catch((e: unknown) =>
          log.error({ err: e }, `[continue-execution] Failed to update session status`),
        );

      await prisma.task
        .update({ where: { id: taskId }, data: { status: 'in-progress' } })
        .catch((e: unknown) =>
          log.error({ err: e }, `[continue-execution] Failed to update task status`),
        );

      await prisma.notification
        .create({
          data: {
            type: 'agent_execution_continued',
            title: 'Additional instruction execution started',
            message: `Executing additional instructions for "${task.title}"`,
            link: `/tasks/${taskId}`,
            metadata: toJsonString({ sessionId: targetSessionId, taskId }),
          },
        })
        .catch((e: unknown) =>
          log.error({ err: e }, `[continue-execution] Failed to create notification`),
        );

      let fullInstruction = `## Additional Instructions\n\n${instruction}`;
      if (previousExecution?.output) {
        const prevOutput = previousExecution.output.substring(0, 3000);
        fullInstruction = `## Previous Execution Content\n\n${prevOutput}${previousExecution.output.length > 3000 ? '\n...(abbreviated)' : ''}\n\n${fullInstruction}`;
      }

      const capturedTargetSessionId = targetSessionId;
      const capturedExecutionDir = executionDir;
      const capturedWorkingDirectory = workingDirectory;

      agentWorkerManager
        .executeTask(
          {
            id: taskId,
            title: task.title,
            description: fullInstruction,
            context: task.executionInstructions || undefined,
            workingDirectory: capturedExecutionDir,
          },
          {
            taskId,
            sessionId: capturedTargetSessionId,
            agentConfigId: agentConfigId || (previousExecution?.agentConfigId ?? undefined),
            workingDirectory: capturedExecutionDir,
            continueFromPrevious: true,
          },
        )
        .then((result) =>
          handleContinueResult({
            result,
            taskId,
            taskTitle: task.title,
            targetSessionId: capturedTargetSessionId,
            configId: task.developerModeConfig?.id,
            branchName: session.branchName,
            workingDirectory: capturedWorkingDirectory,
            executionDir: capturedExecutionDir,
          }),
        )
        .catch((error: Error) =>
          handleContinueError(error, taskId, capturedTargetSessionId),
        )
        .finally(() => {
          releaseTaskExecutionLock(taskId);
        });

      return { success: true, message: 'Continuation started', sessionId: targetSessionId, taskId };
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
);
