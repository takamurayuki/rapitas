'use strict';
/**
 * Copilot Action Service
 *
 * Bridges copilot chat commands to existing backend services.
 * Handles: task analysis, agent execution, subtask creation, status updates.
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { analyzeTask } from '../claude-agent/task-analyzer';
import type { TaskAnalysisResult } from '../claude-agent/types';
import { AgentExecutionService } from '../agent/agent-execution-service';
import { createTask } from '../task/task-mutations';

const log = createLogger('copilot-action');

/** Supported copilot action types. */
export type CopilotActionType =
  | 'analyze'
  | 'execute'
  | 'create_subtasks'
  | 'update_status'
  | 'get_execution_status';

export interface CopilotActionRequest {
  action: CopilotActionType;
  taskId: number;
  params?: Record<string, unknown>;
}

export interface CopilotActionResult {
  success: boolean;
  action: CopilotActionType;
  data: unknown;
  message: string;
}

/**
 * Execute a copilot action by dispatching to the appropriate service.
 *
 * @param request - Action type, task ID, and optional parameters
 * @returns Result with structured data and a human-readable message
 */
export async function executeCopilotAction(
  request: CopilotActionRequest,
): Promise<CopilotActionResult> {
  const { action, taskId, params } = request;

  log.info({ action, taskId }, 'Executing copilot action');

  switch (action) {
    case 'analyze':
      return handleAnalyze(taskId);
    case 'execute':
      return handleExecute(taskId, params);
    case 'create_subtasks':
      return handleCreateSubtasks(taskId, params);
    case 'update_status':
      return handleUpdateStatus(taskId, params);
    case 'get_execution_status':
      return handleGetExecutionStatus(taskId);
    default:
      return {
        success: false,
        action,
        data: null,
        message: `不明なアクション: ${action}`,
      };
  }
}

/** Run task analysis and return structured results. */
async function handleAnalyze(taskId: number): Promise<CopilotActionResult> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      dueDate: true,
      estimatedHours: true,
    },
  });

  if (!task) {
    return { success: false, action: 'analyze', data: null, message: 'タスクが見つかりません' };
  }

  try {
    const { result, tokensUsed } = await analyzeTask(
      {
        id: task.id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        dueDate: task.dueDate,
        estimatedHours: task.estimatedHours,
      },
      { maxSubtasks: 8, priority: 'balanced' },
    );

    const msg = formatAnalysisMessage(result);
    return { success: true, action: 'analyze', data: { ...result, tokensUsed }, message: msg };
  } catch (err) {
    log.error({ err, taskId }, 'Analysis failed');
    return {
      success: false,
      action: 'analyze',
      data: null,
      message: `分析に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Start agent execution for the task. */
async function handleExecute(
  taskId: number,
  params?: Record<string, unknown>,
): Promise<CopilotActionResult> {
  try {
    const service = new AgentExecutionService(prisma);
    const result = await service.executeTask(taskId, {
      useTaskAnalysis: true,
      optimizedPrompt: params?.instructions as string | undefined,
    });

    return {
      success: result.success,
      action: 'execute',
      data: { executionId: result.executionId, sessionId: result.sessionId },
      message: result.success
        ? `エージェント実行を開始しました (ID: ${result.executionId})`
        : `実行に失敗しました: ${result.message}`,
    };
  } catch (err) {
    log.error({ err, taskId }, 'Execution failed');
    return {
      success: false,
      action: 'execute',
      data: null,
      message: `実行に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Create subtasks from analysis results or explicit list. */
async function handleCreateSubtasks(
  taskId: number,
  params?: Record<string, unknown>,
): Promise<CopilotActionResult> {
  const subtasks = params?.subtasks as Array<{ title: string; description?: string }> | undefined;
  if (!subtasks || subtasks.length === 0) {
    return {
      success: false,
      action: 'create_subtasks',
      data: null,
      message: 'サブタスクの情報が必要です。先に「分析して」と指示してください。',
    };
  }

  try {
    const createdIds: number[] = [];
    for (const sub of subtasks) {
      const created = await createTask(prisma, {
        title: sub.title,
        description: sub.description,
        parentId: taskId,
        status: 'todo',
        priority: 'medium',
      });
      if (created) createdIds.push(created.id);
    }

    return {
      success: true,
      action: 'create_subtasks',
      data: { count: createdIds.length, ids: createdIds },
      message: `${createdIds.length}件のサブタスクを作成しました`,
    };
  } catch (err) {
    log.error({ err, taskId }, 'Subtask creation failed');
    return {
      success: false,
      action: 'create_subtasks',
      data: null,
      message: `サブタスク作成に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Update task status. */
async function handleUpdateStatus(
  taskId: number,
  params?: Record<string, unknown>,
): Promise<CopilotActionResult> {
  const status = params?.status as string | undefined;
  if (!status) {
    return {
      success: false,
      action: 'update_status',
      data: null,
      message: 'ステータスを指定してください',
    };
  }

  try {
    const updated = await prisma.task.update({
      where: { id: taskId },
      data: { status },
      select: { id: true, title: true, status: true },
    });

    const statusLabels: Record<string, string> = {
      todo: 'Todo',
      in_progress: '進行中',
      done: '完了',
      completed: '完了',
      blocked: 'ブロック中',
    };

    return {
      success: true,
      action: 'update_status',
      data: updated,
      message: `ステータスを「${statusLabels[status] ?? status}」に変更しました`,
    };
  } catch (err) {
    log.error({ err, taskId }, 'Status update failed');
    return {
      success: false,
      action: 'update_status',
      data: null,
      message: `ステータス更新に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Get current execution status for a task. */
async function handleGetExecutionStatus(
  taskId: number,
): Promise<CopilotActionResult> {
  try {
    const service = new AgentExecutionService(prisma);
    const execution = await service.getLatestExecution(taskId);

    if (!execution) {
      return {
        success: true,
        action: 'get_execution_status',
        data: null,
        message: 'このタスクにはまだ実行履歴がありません',
      };
    }

    return {
      success: true,
      action: 'get_execution_status',
      data: {
        id: execution.id,
        status: execution.status,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
      },
      message: `実行状態: ${execution.status}`,
    };
  } catch (err) {
    log.error({ err, taskId }, 'Execution status check failed');
    return {
      success: false,
      action: 'get_execution_status',
      data: null,
      message: `実行状態の取得に失敗しました`,
    };
  }
}

/** Format analysis result into a readable chat message. */
function formatAnalysisMessage(result: TaskAnalysisResult): string {
  const lines: string[] = [
    `📊 **タスク分析結果**`,
    ``,
    `**複雑度:** ${result.complexity} | **推定時間:** ${result.estimatedTotalHours}h`,
    ``,
    `**概要:** ${result.summary}`,
  ];

  if (result.suggestedSubtasks.length > 0) {
    lines.push(``, `**提案サブタスク (${result.suggestedSubtasks.length}件):**`);
    for (const sub of result.suggestedSubtasks) {
      lines.push(`${sub.order}. ${sub.title} (${sub.estimatedHours ?? '?'}h, ${sub.priority})`);
      if (sub.description) {
        lines.push(`   ${sub.description.slice(0, 100)}`);
      }
    }
  }

  if (result.tips && result.tips.length > 0) {
    lines.push(``, `**💡 ヒント:**`);
    for (const tip of result.tips) {
      lines.push(`- ${tip}`);
    }
  }

  if (result.reasoning) {
    lines.push(``, `**推論:** ${result.reasoning.slice(0, 200)}`);
  }

  return lines.join('\n');
}
