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
import { getIpcExecutionTimeoutMs } from '../execution-timeouts';

const logger = createLogger('agent-worker-manager:api');

/**
 * Terminate a task's executions after a phase-carrying IPC request timed out.
 *
 * A rejected IPC promise only abandons the CALLER's wait — the worker keeps
 * running the CLI child, which then heartbeats on as an orphan: it burns tokens,
 * can hold inherited socket handles, and (because its row stays `running` with
 * a FRESH heartbeat) keeps the task card's spinner and elapsed timer ticking for
 * work nobody is waiting for any more. Observed on task 585: abandoned at 20:00,
 * CLI alive until 28:00. Dynamic import — stop-task-agents pulls in
 * AgentWorkerManager, which imports this module.
 *
 * @param taskId - Task whose executions must be terminated. / 終端対象タスクID
 * @param ipcType - IPC message type that timed out (for the recorded reason). / タイムアウトしたIPC種別
 */
async function terminateAfterIpcTimeout(taskId: number, ipcType: string): Promise<void> {
  try {
    const { stopTaskAgents } = await import('../stop-task-agents');
    const { stoppedCount } = await stopTaskAgents(taskId, {
      errorMessage: `IPC request timeout: ${ipcType} — 実行を終端しました`,
    });
    logger.warn(
      { taskId, ipcType, stoppedCount },
      '[AgentWorkerManager] IPC timed out — terminated the abandoned execution',
    );
  } catch (err) {
    logger.error(
      { err, taskId, ipcType },
      '[AgentWorkerManager] Failed to terminate execution after IPC timeout',
    );
  }
}

/**
 * Whether an error is the IPC layer's own request timeout (ipc.ts:72).
 *
 * @param err - Rejection reason to classify. / 判定対象のエラー
 * @returns true when it is an IPC request timeout. / IPCタイムアウトなら true
 */
function isIpcTimeout(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('IPC request timeout:');
}

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
  try {
    return (await ipc(
      'execute-task',
      { task, options } as unknown as Record<string, unknown>,
      getIpcExecutionTimeoutMs(),
    )) as AgentExecutionResult;
  } catch (err) {
    if (isIpcTimeout(err)) await terminateAfterIpcTimeout(task.id, 'execute-task');
    throw err;
  }
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
    getIpcExecutionTimeoutMs(),
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
    getIpcExecutionTimeoutMs(),
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
    getIpcExecutionTimeoutMs(),
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
    // NOTE: 'Worker not ready' is an expected state (startup / restart / shutdown) — demote to DEBUG.
    // Any other error (IPC timeout, abnormal worker response) is a genuine anomaly — keep as WARN.
    // NOTE: The fixed string 'Worker not ready' is thrown in ipc.ts:58 — update both sites together if changed.
    if (error instanceof Error && error.message === 'Worker not ready') {
      logger.debug(
        { err: error },
        '[AgentWorkerManager] Worker not ready — skipping active execution ID fetch',
      );
    } else {
      logger.warn({ err: error }, '[AgentWorkerManager] Failed to get active execution IDs');
    }
    return [];
  }
}
