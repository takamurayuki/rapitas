/**
 * AgentRetry
 *
 * Retry logic for agent execution: exponential-backoff retry loops for
 * doExecute() and doContinue(), and the shared evaluateRetry() decision function.
 *
 * Not responsible for state transitions or event emission; those remain in AbstractAgent.
 */

import type {
  AgentExecutionContext,
  AgentExecutionResult,
  AgentTaskDefinition,
  ContinuationContext,
} from './types';
import { AgentError } from './interfaces';
import type { AgentLifecycleHooks } from './types';
import { getGlobalRetryPolicy } from './retry-policy';
import type { RetryPolicy } from './retry-policy';

/**
 * Delays execution for the specified milliseconds.
 *
 * @param ms - Delay duration in milliseconds / 待機ミリ秒数
 * @returns Promise that resolves after the delay / 指定時間後に解決するPromise
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Evaluates whether an error should trigger a retry attempt.
 * Consults the onError lifecycle hook first (hook is always authoritative).
 * When no hook is configured, uses the fallback path with configurable limits.
 *
 * Fallback priority order (most-local wins):
 *   1. `policy` argument (if provided)
 *   2. `context.maxRetries` (per-execution override)
 *   3. `RAPITAS_RETRY_MAX` env var
 *   4. Hard-coded default (3)
 *
 * @param error - The error that occurred / 発生したエラー
 * @param context - Execution context / 実行コンテキスト
 * @param retryCount - Current retry count (0-based) / 現在のリトライ回数（0始まり）
 * @param hooks - Lifecycle hooks / ライフサイクルフック
 * @param logFn - Logger function forwarded from the agent / エージェントからのログ関数
 * @param policy - Optional retry policy override (caller-supplied) / 呼び出し元からのポリシー上書き
 * @returns Retry decision with shouldRetry flag and delay / リトライ判断とディレイ
 */
export async function evaluateRetry(
  error: AgentError,
  context: AgentExecutionContext,
  retryCount: number,
  hooks: AgentLifecycleHooks,
  logFn: (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown) => void,
  policy?: RetryPolicy,
): Promise<{ shouldRetry: boolean; delay: number }> {
  // NOTE(agent): Resolve effective policy once per call (lazy env read keeps tests hermetic).
  const effectivePolicy = policy ?? getGlobalRetryPolicy();

  // NOTE(agent): Hard upper bound prevents infinite retries even if hooks always return true.
  if (retryCount >= effectivePolicy.upperBound) {
    logFn('error', `Max retry upper bound (${effectivePolicy.upperBound}) reached, giving up`);
    return { shouldRetry: false, delay: 0 };
  }

  // NOTE(agent): onError hook is always consulted first and takes precedence over policy/context.
  if (hooks.onError) {
    try {
      const hookResult = await hooks.onError(context, error, retryCount);
      return {
        shouldRetry: hookResult.retry,
        delay: hookResult.delay ?? effectivePolicy.delayMs,
      };
    } catch (hookError) {
      logFn(
        'warn',
        `onError hook threw an error: ${hookError instanceof Error ? hookError.message : String(hookError)}`,
      );
      return { shouldRetry: false, delay: 0 };
    }
  }

  // NOTE(agent): Without an onError hook, apply the fallback policy.
  // Priority: policy argument > context.maxRetries > env var (already in effectivePolicy.maxRetries).
  const maxRetries =
    policy !== undefined
      ? policy.maxRetries
      : (context.maxRetries ?? effectivePolicy.maxRetries);

  if (error.recoverable && retryCount < maxRetries) {
    return { shouldRetry: true, delay: effectivePolicy.delayMs };
  }

  return { shouldRetry: false, delay: 0 };
}

/**
 * Executes doExecute() with automatic retry on recoverable errors.
 *
 * @param doExecute - The provider-specific execute function / プロバイダ固有の実行関数
 * @param task - Task definition / タスク定義
 * @param context - Execution context / 実行コンテキスト
 * @param hooks - Lifecycle hooks / ライフサイクルフック
 * @param transitionFn - State transition function / 状態遷移関数
 * @param isDisposedFn - Returns whether the agent is disposed / エージェントが破棄済みか返す関数
 * @param getStateFn - Returns current agent state / 現在のエージェント状態を返す関数
 * @param logFn - Logger function / ログ関数
 * @returns Execution result / 実行結果
 */
export async function executeWithRetry(
  doExecute: (
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ) => Promise<AgentExecutionResult>,
  task: AgentTaskDefinition,
  context: AgentExecutionContext,
  hooks: AgentLifecycleHooks,
  transitionFn: (state: string, reason?: string) => Promise<void>,
  isDisposedFn: () => boolean,
  getStateFn: () => string,
  logFn: (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown) => void,
): Promise<AgentExecutionResult> {
  let retryCount = 0;

  while (true) {
    try {
      return await doExecute(task, context);
    } catch (error) {
      const agentError =
        error instanceof AgentError
          ? error
          : error instanceof Error
            ? new AgentError(error.message, 'execution', false, undefined, error)
            : new AgentError(String(error), 'internal', false);

      const retryDecision = await evaluateRetry(agentError, context, retryCount, hooks, logFn);

      if (!retryDecision.shouldRetry) {
        throw agentError;
      }

      retryCount++;
      logFn(
        'warn',
        `Retrying execution (attempt ${retryCount}) after ${retryDecision.delay}ms delay. Error: ${agentError.message}`,
      );

      await sleep(retryDecision.delay);

      // NOTE(agent): Re-check disposal/cancellation state before each retry attempt.
      if (isDisposedFn() || getStateFn() === 'cancelled') {
        throw new AgentError(
          'Agent was disposed or cancelled during retry delay',
          'internal',
          false,
        );
      }

      // NOTE(agent): Transition back to running state for the retry attempt.
      await transitionFn('running', `Retry attempt ${retryCount}`);
    }
  }
}

/**
 * Executes doContinue() with automatic retry on recoverable errors.
 *
 * @param doContinue - The provider-specific continue function / プロバイダ固有の継続関数
 * @param continuation - Continuation context / 継続コンテキスト
 * @param context - Execution context / 実行コンテキスト
 * @param hooks - Lifecycle hooks / ライフサイクルフック
 * @param transitionFn - State transition function / 状態遷移関数
 * @param isDisposedFn - Returns whether the agent is disposed / エージェントが破棄済みか返す関数
 * @param getStateFn - Returns current agent state / 現在のエージェント状態を返す関数
 * @param logFn - Logger function / ログ関数
 * @returns Execution result / 実行結果
 */
export async function continueWithRetry(
  doContinue: (
    continuation: ContinuationContext,
    context: AgentExecutionContext,
  ) => Promise<AgentExecutionResult>,
  continuation: ContinuationContext,
  context: AgentExecutionContext,
  hooks: AgentLifecycleHooks,
  transitionFn: (state: string, reason?: string) => Promise<void>,
  isDisposedFn: () => boolean,
  getStateFn: () => string,
  logFn: (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown) => void,
): Promise<AgentExecutionResult> {
  let retryCount = 0;

  while (true) {
    try {
      return await doContinue(continuation, context);
    } catch (error) {
      const agentError =
        error instanceof AgentError
          ? error
          : error instanceof Error
            ? new AgentError(error.message, 'execution', false, undefined, error)
            : new AgentError(String(error), 'internal', false);

      const retryDecision = await evaluateRetry(agentError, context, retryCount, hooks, logFn);

      if (!retryDecision.shouldRetry) {
        throw agentError;
      }

      retryCount++;
      logFn(
        'warn',
        `Retrying continuation (attempt ${retryCount}) after ${retryDecision.delay}ms delay. Error: ${agentError.message}`,
      );

      await sleep(retryDecision.delay);

      if (isDisposedFn() || getStateFn() === 'cancelled') {
        throw new AgentError(
          'Agent was disposed or cancelled during retry delay',
          'internal',
          false,
        );
      }

      await transitionFn('running', `Retry attempt ${retryCount}`);
    }
  }
}
