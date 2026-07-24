/**
 * Workflow Mode and Complexity Handlers
 *
 * Route handlers for workflow mode management and complexity analysis.
 * Not responsible for file I/O, plan approval, or status transitions.
 */

import { prisma } from '../../../config';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  parseId,
} from '../../../middleware/error-handler';
import { WORKFLOW_MODES } from '../../../services/workflow/workflow-types';
import { isWorkflowMode } from '../../../services/workflow/workflow-types.guards.generated';
import {
  analyzeTaskComplexityWithLearning,
  getWorkflowModeConfig,
  type TaskComplexityInput,
} from '../../../services/workflow/complexity-analyzer';
import { createLogger } from '../../../config/logger';
import { parseSpecArray } from '../../../utils/common';
import {
  resolveTaskWorkflowState,
  resolveTaskForComplexityAnalysis,
} from '../../../services/task/task-resolver';

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
  set: _set,
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
    const validModes = WORKFLOW_MODES;

    if (!parsedBody?.mode || !isWorkflowMode(parsedBody.mode)) {
      throw new ValidationError(`Invalid mode. Must be one of: ${validModes.join(', ')}`);
    }

    const task = await resolveTaskWorkflowState(taskId);
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
 * Handler for POST /tasks/:taskId/set-workflow-disabled
 * Toggles the per-task "workflow disabled" (direct-implementation) flag. See
 * UserSettings.workflowDisabledGlobally for the global equivalent — effective
 * state is the OR of both. Locked once the task has left 'todo' so the toggle
 * can't change mid-execution or after completion (enforced server-side, not
 * just hidden in the UI).
 *
 * @param params - Route params with taskId / ルートパラメータ
 * @param body - Request body with the desired disabled flag / リクエストボディ
 * @param set - Elysia response set / Elysiaレスポンス
 * @returns Updated task's workflowDisabled state
 * @throws {ValidationError} When `disabled` is missing/not a boolean
 * @throws {ConflictError} When the task has already left 'todo' status
 * @throws {NotFoundError} When task does not exist
 */
export async function handleSetWorkflowDisabled({
  params,
  body,
  set: _set,
}: {
  params: { taskId: string };
  body: unknown;
  set: { status: number };
}) {
  try {
    const taskId = parseId(params.taskId, 'task ID');

    const parsedBody = body as { disabled?: unknown };
    if (typeof parsedBody?.disabled !== 'boolean') {
      throw new ValidationError('disabled must be a boolean');
    }
    const disabled = parsedBody.disabled;

    const task = await resolveTaskWorkflowState(taskId);
    if (!task) throw new NotFoundError('Task not found');

    if (task.status !== 'todo') {
      throw new ConflictError('タスクの実行が開始されているため、この設定は変更できません');
    }

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: { workflowDisabled: disabled, updatedAt: new Date() } as unknown as Parameters<
        typeof prisma.task.update
      >[0]['data'],
    });

    await prisma.activityLog.create({
      data: {
        taskId,
        action: 'workflow_disabled_changed',
        metadata: JSON.stringify({ disabled }),
        createdAt: new Date(),
      },
    });

    return {
      success: true,
      taskId,
      workflowDisabled: disabled,
      task: updatedTask,
    };
  } catch (err) {
    if (
      err instanceof ValidationError ||
      err instanceof NotFoundError ||
      err instanceof ConflictError
    ) {
      throw err;
    }
    log.error({ err }, 'Error setting workflow-disabled flag');
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
  set: _set,
}: {
  params: { taskId: string };
  set: { status: number };
}) {
  try {
    const taskId = parseId(params.taskId, 'task ID');

    const task = await resolveTaskForComplexityAnalysis(taskId);
    if (!task) throw new NotFoundError('Task not found');

    const complexityInput: TaskComplexityInput = {
      title: task.title,
      description: task.description,
      estimatedHours: task.estimatedHours,
      labels: task.taskLabels.map((tl) => tl.label.name),
      priority: task.priority,
      themeId: task.themeId,
      goals: parseSpecArray(task.goals),
      constraints: parseSpecArray(task.constraints),
      acceptanceCriteria: parseSpecArray(task.acceptanceCriteria),
    };

    const analysisResult = await analyzeTaskComplexityWithLearning(complexityInput);

    // NOTE: Apply the recommended MODE only. The heuristic score is NOT
    // persisted — task.complexityScore is reserved for the research agent's
    // code-grounded assessment (applyResearchAssessedComplexity); the UI shows
    // 複雑度"-" until that lands. The full analysis is still returned to the
    // caller for transient display.
    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
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
export async function handleGetModes({ set: _set }: { set: { status: number } }) {
  try {
    const modeConfig = getWorkflowModeConfig();
    return { success: true, modes: modeConfig, defaultMode: 'comprehensive' };
  } catch (err) {
    log.error({ err }, 'Error fetching workflow modes');
    throw err;
  }
}
