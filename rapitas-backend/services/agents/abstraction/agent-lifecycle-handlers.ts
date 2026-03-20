/**
 * AgentLifecycleHandlers
 *
 * Implements the execute() and continue() lifecycle method bodies for
 * AbstractAgent. Extracted here so the main class file stays under 300 lines.
 *
 * Not responsible for state storage, event emission setup, or retry logic;
 * those remain in AbstractAgent and agent-retry.ts respectively.
 */

import type {
  AgentState,
  AgentMetadata,
  AgentExecutionContext,
  AgentTaskDefinition,
  AgentExecutionResult,
  AgentLifecycleHooks,
  ContinuationContext,
  ExecutionMetrics,
  DebugLogEntry,
} from './types';
import { AgentEventEmitter } from './event-emitter';
import { AgentError } from './interfaces';
import { executeWithRetry, continueWithRetry } from './agent-retry';

/**
 * Callbacks that give lifecycle handlers read/write access to AbstractAgent's
 * private fields without requiring a Proxy or circular imports.
 */
export interface ExecutionCallbacks {
  getState: () => AgentState;
  getIsDisposed: () => boolean;
  getMetadata: () => AgentMetadata;
  setCurrentContext: (ctx: AgentExecutionContext | null) => void;
  setMetrics: (m: ExecutionMetrics | null) => void;
  setDebugLogs: (logs: DebugLogEntry[]) => void;
  getMetrics: () => ExecutionMetrics | null;
  getDebugLogs: () => DebugLogEntry[];
}

/**
 * Runs the full execute lifecycle: hooks, state transitions, retry, and result enrichment.
 *
 * @param task - Task to execute / 実行するタスク
 * @param context - Execution context / 実行コンテキスト
 * @param cb - Callbacks for accessing agent fields / エージェントフィールドアクセスコールバック
 * @param hooks - Lifecycle hooks / ライフサイクルフック
 * @param events - Event emitter / イベントエミッター
 * @param doExecute - Provider-specific execute function / プロバイダ固有の実行関数
 * @param transitionFn - State transition function / 状態遷移関数
 * @param logFn - Logger function / ログ関数
 * @returns Execution result / 実行結果
 */
export async function runExecute(
  task: AgentTaskDefinition,
  context: AgentExecutionContext,
  cb: ExecutionCallbacks,
  hooks: AgentLifecycleHooks,
  events: AgentEventEmitter,
  doExecute: (task: AgentTaskDefinition, ctx: AgentExecutionContext) => Promise<AgentExecutionResult>,
  transitionFn: (state: AgentState, reason?: string) => Promise<void>,
  logFn: (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown) => void,
): Promise<AgentExecutionResult> {
  events.setExecutionId(context.executionId);
  cb.setCurrentContext(context);
  cb.setMetrics({ startTime: new Date() });
  cb.setDebugLogs([]);

  try {
    if (hooks.beforeExecute) {
      const shouldContinue = await hooks.beforeExecute(context, task);
      if (shouldContinue === false) {
        logFn('info', 'Execution cancelled by beforeExecute hook');
        return buildCancelledResult('Cancelled by beforeExecute hook', cb);
      }
    }

    await transitionFn('initializing');
    await transitionFn('running');

    // NOTE(agent): Retry loop wraps doExecute() to handle transient errors with exponential backoff.
    const result = await executeWithRetry(
      doExecute, task, context, hooks, transitionFn,
      cb.getIsDisposed, cb.getState, logFn,
    );

    const metrics = cb.getMetrics()!;
    metrics.endTime = new Date();
    metrics.durationMs = metrics.endTime.getTime() - metrics.startTime.getTime();

    if (result.pendingQuestion) {
      await transitionFn('waiting_for_input');
    } else if (result.success) {
      await transitionFn('completed');
    } else {
      await transitionFn('failed');
    }

    if (hooks.afterExecute) await hooks.afterExecute(context, result);

    cb.getMetadata().lastUsedAt = new Date();
    return enrichResult(result, cb);
  } catch (error) {
    const agentError = wrapError(error);
    await transitionFn('failed');
    await events.emitError(agentError, agentError.recoverable);
    return buildErrorResult(agentError, cb);
  } finally {
    cb.setCurrentContext(null);
  }
}

/**
 * Runs the full continue lifecycle: state check, retry, and result enrichment.
 *
 * @param continuation - Continuation context / 継続コンテキスト
 * @param context - Execution context / 実行コンテキスト
 * @param cb - Callbacks for accessing agent fields / エージェントフィールドアクセスコールバック
 * @param hooks - Lifecycle hooks / ライフサイクルフック
 * @param events - Event emitter / イベントエミッター
 * @param doContinue - Provider-specific continue function / プロバイダ固有の継続関数
 * @param transitionFn - State transition function / 状態遷移関数
 * @param logFn - Logger function / ログ関数
 * @returns Execution result / 実行結果
 * @throws {AgentError} If the agent is not in 'waiting_for_input' state / 待機状態でない場合
 */
export async function runContinue(
  continuation: ContinuationContext,
  context: AgentExecutionContext,
  cb: ExecutionCallbacks,
  hooks: AgentLifecycleHooks,
  events: AgentEventEmitter,
  doContinue: (cont: ContinuationContext, ctx: AgentExecutionContext) => Promise<AgentExecutionResult>,
  transitionFn: (state: AgentState, reason?: string) => Promise<void>,
  logFn: (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown) => void,
): Promise<AgentExecutionResult> {
  if (cb.getState() !== 'waiting_for_input') {
    throw new AgentError(
      `Cannot continue execution: agent is in state '${cb.getState()}', expected 'waiting_for_input'`,
      'execution', false,
    );
  }

  events.setExecutionId(context.executionId);
  cb.setCurrentContext(context);

  try {
    await transitionFn('running');

    // NOTE(agent): Retry loop for continuation, same pattern as executeWithRetry.
    const result = await continueWithRetry(
      doContinue, continuation, context, hooks, transitionFn,
      cb.getIsDisposed, cb.getState, logFn,
    );

    if (result.pendingQuestion) {
      await transitionFn('waiting_for_input');
    } else if (result.success) {
      await transitionFn('completed');
    } else {
      await transitionFn('failed');
    }

    return enrichResult(result, cb);
  } catch (error) {
    const agentError = wrapError(error);
    await transitionFn('failed');
    await events.emitError(agentError, agentError.recoverable);
    return buildErrorResult(agentError, cb);
  } finally {
    cb.setCurrentContext(null);
  }
}

// ============================================================================
// Internal helpers
// ============================================================================

function wrapError(error: unknown): AgentError {
  if (error instanceof AgentError) return error;
  if (error instanceof Error) return new AgentError(error.message, 'execution', false, undefined, error);
  return new AgentError(String(error), 'internal', false);
}

function enrichResult(result: AgentExecutionResult, cb: ExecutionCallbacks): AgentExecutionResult {
  return {
    ...result,
    metrics: cb.getMetrics() || undefined,
    debugInfo: { logs: [...cb.getDebugLogs()], ...result.debugInfo },
  };
}

function buildCancelledResult(reason: string, cb: ExecutionCallbacks): AgentExecutionResult {
  return {
    success: false, state: 'cancelled', output: '', errorMessage: reason,
    metrics: cb.getMetrics() || undefined, debugInfo: { logs: [...cb.getDebugLogs()] },
  };
}

function buildErrorResult(error: AgentError, cb: ExecutionCallbacks): AgentExecutionResult {
  return {
    success: false, state: 'failed', output: '', errorMessage: error.message,
    metrics: cb.getMetrics() || undefined, debugInfo: { logs: [...cb.getDebugLogs()] },
  };
}
