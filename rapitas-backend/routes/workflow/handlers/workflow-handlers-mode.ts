/**
 * Workflow Mode and Complexity Handlers
 *
 * Route handlers for workflow mode management and complexity analysis.
 * Not responsible for file I/O, plan approval, or status transitions.
 */

import { prisma } from '../../../config';
import { NotFoundError, ValidationError, parseId } from '../../../middleware/error-handler';
import {
  analyzeTaskComplexityWithLearning,
  getWorkflowModeConfig,
  type TaskComplexityInput,
} from '../../../services/workflow/complexity-analyzer';
import { createLogger } from '../../../config/logger';

const log = createLogger('routes:workflow:handlers:mode');

/**
 * Handler for POST /tasks/:taskId/set-mode
 * Sets the workflow mode (lightweight / standard / comprehensive) for a task.
 *
 * @param params - Route params with taskId / ルートパラメータ
 * @param body - Request body with mode and optional override flag / リクエストボディ
 * @param set - Elysia response set / Elysiaレスポンス
 * @returns Updated task with new workflow mode
 * @throws {ValidationError} When mode is invalid
 * @throws {NotFoundError} When task does not exist
 */
export async function handleSetMode({
  params,
  body,
  set,
}: {
  params: { taskId: string };
  body: unknown;
  set: { status: number };
}) {
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
    if (!task) throw new NotFoundError('Task not found');

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
        workflowMode: parsedBody.mode,
        workflowModeOverride: parsedBody.override ?? true,
        updatedAt: new Date(),
      },
    });

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
    log.error({ err }, 'Error setting workflow mode');
    throw err;
  }
}

/**
 * Handler for GET /tasks/:taskId/analyze-complexity
 * Analyzes task complexity and recommends a workflow mode.
 *
 * @param params - Route params with taskId / ルートパラメータ
 * @param set - Elysia response set / Elysiaレスポンス
 * @returns Complexity analysis result and applied workflow mode
 * @throws {NotFoundError} When task does not exist
 */
export async function handleAnalyzeComplexity({
  params,
  set,
}: {
  params: { taskId: string };
  set: { status: number };
}) {
  try {
    const taskId = parseId(params.taskId, 'task ID');

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        theme: true,
        taskLabels: { include: { label: true } },
      },
    });

    if (!task) throw new NotFoundError('Task not found');

    const complexityInput: TaskComplexityInput = {
      title: task.title,
      description: task.description,
      estimatedHours: task.estimatedHours,
      labels: task.taskLabels.map((tl) => tl.label.name),
      priority: task.priority,
      themeId: task.themeId,
    };

    const analysisResult = await analyzeTaskComplexityWithLearning(complexityInput);

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
    log.error({ err }, 'Error analyzing task complexity');
    throw err;
  }
}

/**
 * Handler for GET /modes
 * Returns all available workflow mode configurations.
 *
 * @param set - Elysia response set / Elysiaレスポンス
 * @returns Available modes and default mode name
 */
export async function handleGetModes({ set }: { set: { status: number } }) {
  try {
    const modeConfig = getWorkflowModeConfig();
    return { success: true, modes: modeConfig, defaultMode: 'comprehensive' };
  } catch (err) {
    log.error({ err }, 'Error fetching workflow modes');
    throw err;
  }
}
