/**
 * ExecuteRoutes
 *
 * Elysia route handler for starting a parallel execution session:
 * - POST /parallel/tasks/:id/execute
 *
 * Handles both workflow-based (AIOrchestra) and direct executor paths.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config';
import {
  createDependencyAnalyzer,
  type ParallelExecutionConfig,
} from '../../../services/parallel-execution';
import { AIOrchestra } from '../../../services/workflow/ai-orchestra';
import { buildAnalysisInput } from './analysis-helpers';
import { getParallelExecutor } from './executor-singleton';
import { validateWorkingDirectory } from './working-dir-guard';

const log = createLogger('routes:parallel-execution:execute');

export const executeRoutes = new Elysia()
  /**
   * Start a parallel execution session.
   */
  .post(
    '/tasks/:id/execute',
    async (context) => {
      const { params, body } = context;
      try {
        const taskId = parseInt(params.id);
        const config = (body as Record<string, unknown>).config as
          | Partial<ParallelExecutionConfig>
          | undefined;

        const task = await prisma.task.findUnique({
          where: { id: taskId },
          include: {
            theme: true,
            subtasks: {
              include: {
                prompts: true,
              },
            },
          },
        });

        if (!task) {
          return { success: false, error: 'タスクが見つかりません' };
        }

        if (task.subtasks.length === 0) {
          return { success: false, error: 'サブタスクがありません' };
        }

        const input = await buildAnalysisInput(taskId);
        const analyzer = createDependencyAnalyzer();
        const analysisResult = analyzer.analyze({ ...input, config });

        let devConfig = await prisma.developerModeConfig.findUnique({ where: { taskId } });

        if (!devConfig) {
          devConfig = await prisma.developerModeConfig.create({
            data: { taskId, isEnabled: true },
          });
        }

        const agentSession = await prisma.agentSession.create({
          data: {
            configId: devConfig.id,
            status: 'running',
            startedAt: new Date(),
            metadata: JSON.stringify({
              type: 'parallel_execution',
              planId: analysisResult.plan.id,
              maxConcurrency: config?.maxConcurrentAgents || 3,
            }),
          },
        });

        const useWorkflow = (body as Record<string, unknown>).useWorkflow !== false;
        const subtaskIds = task.subtasks.map((s) => s.id);

        if (useWorkflow) {
          const userSettings = await prisma.userSettings.findFirst();
          const autoApprove =
            ((userSettings as Record<string, unknown> | null)?.autoApproveSubtaskPlan as
              | boolean
              | undefined) ?? true;

          await prisma.task.updateMany({
            where: { id: { in: subtaskIds } },
            data: {
              workflowMode: 'lightweight',
              workflowStatus: 'draft',
              autoApprovePlan: autoApprove,
            },
          });

          const orchestra = AIOrchestra.getInstance();
          const result = await orchestra.conductWorkflow(subtaskIds, {
            maxConcurrency: config?.maxConcurrentAgents || 3,
            priorityStrategy: 'dependency_aware',
          });

          log.info(
            { taskId, sessionId: result.sessionId, enqueuedTasks: result.enqueuedTasks },
            '[ParallelExecution] Started workflow-based execution',
          );

          return {
            success: true,
            data: {
              sessionId: result.sessionId,
              agentSessionId: agentSession.id,
              orchestraSessionId: result.sessionId,
              plan: {
                id: analysisResult.plan.id,
                groups: analysisResult.plan.groups.length,
                maxConcurrency: analysisResult.plan.maxConcurrency,
                estimatedTotalDuration: analysisResult.plan.estimatedTotalDuration,
                parallelEfficiency: analysisResult.plan.parallelEfficiency,
              },
              workflow: {
                enqueuedTasks: result.enqueuedTasks,
                skippedTasks: result.skippedTasks,
                errors: result.errors,
              },
              status: 'running',
            },
          };
        }

        const wdResult = validateWorkingDirectory(taskId, task.theme?.workingDirectory, 'parallel-start');
        if (!wdResult.ok) {
          log.error(`[parallel-start] Task ${taskId} rejected: ${wdResult.error}`);
          return { success: false, error: wdResult.error };
        }
        const workingDirectory = wdResult.workingDirectory;

        log.info(
          `[parallel-start] Starting parallel session for task ${taskId} in working directory: ${workingDirectory}`,
        );
        log.info(
          `[parallel-start] Theme: ${task.theme?.name || 'none'}, ThemeID: ${task.theme?.id || 'none'}`,
        );

        const executor = getParallelExecutor();
        const session = await executor.startSession(
          taskId,
          analysisResult.plan,
          analysisResult.treeMap.nodes,
          workingDirectory,
        );

        return {
          success: true,
          data: {
            sessionId: session.sessionId,
            agentSessionId: agentSession.id,
            plan: {
              id: analysisResult.plan.id,
              groups: analysisResult.plan.groups.length,
              maxConcurrency: analysisResult.plan.maxConcurrency,
              estimatedTotalDuration: analysisResult.plan.estimatedTotalDuration,
              parallelEfficiency: analysisResult.plan.parallelEfficiency,
            },
            status: session.status,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error({ errorMessage }, '[ParallelExecution] Error starting session');
        return { success: false, error: errorMessage };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        config: t.Optional(
          t.Object({
            maxConcurrentAgents: t.Optional(t.Number()),
            questionTimeoutSeconds: t.Optional(t.Number()),
            taskTimeoutSeconds: t.Optional(t.Number()),
            retryOnFailure: t.Optional(t.Boolean()),
            maxRetries: t.Optional(t.Number()),
            logSharing: t.Optional(t.Boolean()),
            coordinationEnabled: t.Optional(t.Boolean()),
          }),
        ),
        useWorkflow: t.Optional(t.Boolean()),
      }),
    },
  );
