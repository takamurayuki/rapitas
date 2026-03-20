/**
 * Agent Worker Public API
 *
 * All orchestrator-compatible public methods that delegate to the worker via IPC.
 * Imported by AgentWorkerManager to reduce the main class file size.
 * Not responsible for IPC protocol, lifecycle management, or event bridging.
 */

import { createLogger } from '../../../config/logger';
import type { AgentTask, AgentExecutionResult } from '../base-agent';
import type { ExecutionOptions, ExecutionState } from '../orchestrator/types';
import type { QuestionKey } from '../question-detection';

const logger = createLogger('agent-worker-manager:api');

/** Minimal IPC sender type accepted by all API helpers. */
export type IpcSender = (
  type: string,
  data: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<unknown>;

/**
 * Execute a task via the worker.
 *
 * @param ipc - IPC sender function / IPC送信関数
 * @param task - Task to execute / 実行タスク
 * @param options - Execution options / 実行オプション
 * @returns Execution result / 実行結果
 */
export async function executeTask(
  ipc: IpcSender,
  task: AgentTask,
  options: ExecutionOptions,
): Promise<AgentExecutionResult> {
  logger.info({ taskId: task.id }, '[AgentWorkerManager] Delegating task execution to worker');
  return ipc(
    'execute-task',
    { task, options } as unknown as Record<string, unknown>,
    1200000,
  ) as Promise<AgentExecutionResult>;
}

/**
 * Continue an existing execution.
 *
 * @param ipc - IPC sender function / IPC送信関数
 * @param executionId - Execution ID to continue / 継続する実行ID
 * @param response - User response text / ユーザー応答テキスト
 * @param options - Partial execution options / 実行オプション（部分）
 * @returns Execution result / 実行結果
 */
export async function executeContinuation(
  ipc: IpcSender,
  executionId: number,
  response: string,
  options: Partial<ExecutionOptions> = {},
): Promise<AgentExecutionResult> {
  return ipc(
    'continue-execution',
    { executionId, response, options } as unknown as Record<string, unknown>,
    1200000,
  ) as Promise<AgentExecutionResult>;
}

/**
 * Continue an existing execution with a continuation lock.
 *
 * @param ipc - IPC sender function / IPC送信関数
 * @param executionId - Execution ID to continue / 継続する実行ID
 * @param response - User response text / ユーザー応答テキスト
 * @param options - Partial execution options / 実行オプション（部分）
 * @returns Execution result / 実行結果
 */
export async function executeContinuationWithLock(
  ipc: IpcSender,
  executionId: number,
  response: string,
  options: Partial<ExecutionOptions> = {},
): Promise<AgentExecutionResult> {
  return ipc(
    'continue-with-lock',
    { executionId, response, options } as unknown as Record<string, unknown>,
    1200000,
  ) as Promise<AgentExecutionResult>;
}

/**
 * Resume an interrupted execution.
 *
 * @param ipc - IPC sender function / IPC送信関数
 * @param executionId - Execution ID to resume / 再開する実行ID
 * @param options - Partial execution options / 実行オプション（部分）
 * @returns Execution result / 実行結果
 */
export async function resumeInterruptedExecution(
  ipc: IpcSender,
  executionId: number,
  options: Partial<ExecutionOptions> = {},
): Promise<AgentExecutionResult> {
  return ipc(
    'resume-execution',
    { executionId, options } as unknown as Record<string, unknown>,
    1200000,
  ) as Promise<AgentExecutionResult>;
}

/**
 * Retrieve active executions for a session.
 *
 * @param ipc - IPC sender function / IPC送信関数
 * @param sessionId - Session ID / セッションID
 * @returns Array of execution states / 実行状態リスト
 */
export async function getSessionExecutionsAsync(
  ipc: IpcSender,
  sessionId: number,
): Promise<ExecutionState[]> {
  const result = await ipc('get-session-executions', { sessionId }, 5000);
  return (
    result as Array<{
      executionId: number;
      sessionId: number;
      agentId: string;
      taskId: number;
      status: string;
      startedAt: string;
      output: string;
    }>
  ).map((s) => ({
    executionId: s.executionId,
    sessionId: s.sessionId,
    agentId: s.agentId,
    taskId: s.taskId,
    status: s.status as ExecutionState['status'],
    startedAt: new Date(s.startedAt),
    output: s.output,
  }));
}

/**
 * Retrieve question timeout info for an execution.
 *
 * @param ipc - IPC sender function / IPC送信関数
 * @param executionId - Execution ID / 実行ID
 * @returns Timeout info or null if not set / タイムアウト情報またはnull
 */
export async function getQuestionTimeoutInfoAsync(
  ipc: IpcSender,
  executionId: number,
): Promise<{
  remainingSeconds: number;
  deadline: Date;
  questionKey?: QuestionKey;
} | null> {
  const result = await ipc('get-timeout-info', { executionId }, 5000);
  if (!result) return null;
  const info = result as {
    remainingSeconds: number;
    deadline: string;
    questionKey?: QuestionKey;
  };
  return {
    ...info,
    deadline: new Date(info.deadline),
  };
}

/**
 * Retrieve the list of active execution IDs from the worker.
 *
 * @param ipc - IPC sender function / IPC送信関数
 * @returns Array of active execution IDs / アクティブ実行IDリスト
 */
export async function getActiveExecutionIdsAsync(ipc: IpcSender): Promise<number[]> {
  try {
    const result = await ipc('get-active-agent-infos', {}, 5000);
    const infos = result as Array<{ executionId: number }>;
    return infos.map((info) => info.executionId);
  } catch (error) {
    logger.warn({ err: error }, '[AgentWorkerManager] Failed to get active execution IDs');
    return [];
  }
}
