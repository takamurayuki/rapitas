/**
 * AgentEventHelpers
 *
 * Mixin-style helper functions that emit agent events and invoke the
 * corresponding lifecycle hooks. These are extracted from AbstractAgent to
 * keep that class under the 300-line limit.
 *
 * Not responsible for state management or retry logic.
 */

import type {
  AgentExecutionContext,
  AgentLifecycleHooks,
  PendingQuestion,
  AgentArtifact,
  GitCommitInfo,
  ExecutionMetrics,
} from './types';
import type { AgentEventEmitter } from './event-emitter';

/**
 * Emits output content through the event emitter.
 *
 * @param events - Agent event emitter / エージェントイベントエミッター
 * @param content - Output text / 出力テキスト
 * @param isError - Whether this is error output / エラー出力かどうか
 * @param isPartial - Whether this is a partial chunk / 部分チャンクかどうか
 */
export async function emitOutput(
  events: AgentEventEmitter,
  content: string,
  isError = false,
  isPartial = false,
): Promise<void> {
  await events.emitOutput(content, isError, isPartial);
}

/**
 * Emits a question for the user and invokes the onQuestion hook if configured.
 *
 * @param events - Agent event emitter / エージェントイベントエミッター
 * @param hooks - Lifecycle hooks / ライフサイクルフック
 * @param context - Current execution context / 現在の実行コンテキスト
 * @param question - Question to emit / 送信する質問
 * @param logFn - Logger function / ログ関数
 */
export async function emitQuestion(
  events: AgentEventEmitter,
  hooks: AgentLifecycleHooks,
  context: AgentExecutionContext,
  question: PendingQuestion,
  logFn: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void,
): Promise<void> {
  await events.emitQuestion(question);

  if (hooks.onQuestion) {
    const autoResponse = await hooks.onQuestion(context, question);
    if (autoResponse !== null) {
      logFn('info', `Auto-response from hook: ${autoResponse}`);
      // NOTE: Auto-response handling is delegated to subclasses.
    }
  }
}

/**
 * Emits an artifact event and invokes the onArtifact hook if configured.
 *
 * @param events - Agent event emitter / エージェントイベントエミッター
 * @param hooks - Lifecycle hooks / ライフサイクルフック
 * @param context - Current execution context / 現在の実行コンテキスト
 * @param artifact - Artifact to emit / 送信するアーティファクト
 */
export async function emitArtifact(
  events: AgentEventEmitter,
  hooks: AgentLifecycleHooks,
  context: AgentExecutionContext,
  artifact: AgentArtifact,
): Promise<void> {
  await events.emitArtifact(artifact);

  if (hooks.onArtifact) {
    await hooks.onArtifact(context, artifact);
  }
}

/**
 * Emits a Git commit event.
 *
 * @param events - Agent event emitter / エージェントイベントエミッター
 * @param commit - Git commit info / Gitコミット情報
 */
export async function emitCommit(
  events: AgentEventEmitter,
  commit: GitCommitInfo,
): Promise<void> {
  await events.emitCommit(commit);
}

/**
 * Notifies listeners about a tool execution start and returns an end() callback.
 *
 * @param events - Agent event emitter / エージェントイベントエミッター
 * @param hooks - Lifecycle hooks / ライフサイクルフック
 * @param context - Current execution context / 現在の実行コンテキスト
 * @param toolId - Unique tool execution ID / ツール実行の一意ID
 * @param toolName - Tool name / ツール名
 * @param input - Tool input / ツール入力
 * @param logFn - Logger function / ログ関数
 * @returns Object with an end() callback to signal tool completion / ツール完了を通知するend()コールバック付きオブジェクト
 */
export async function notifyToolExecution(
  events: AgentEventEmitter,
  hooks: AgentLifecycleHooks,
  context: AgentExecutionContext,
  toolId: string,
  toolName: string,
  input: unknown,
  logFn: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void,
): Promise<{ end: (output: unknown, success: boolean, error?: string) => Promise<void> }> {
  const startTime = Date.now();

  if (hooks.beforeToolCall) {
    const shouldContinue = await hooks.beforeToolCall(context, toolName, input);
    if (shouldContinue === false) {
      logFn('info', `Tool ${toolName} skipped by beforeToolCall hook`);
    }
  }

  await events.emitToolStart(toolId, toolName, input);

  return {
    end: async (output: unknown, success: boolean, error?: string) => {
      const durationMs = Date.now() - startTime;
      await events.emitToolEnd(toolId, toolName, output, success, durationMs, error);

      if (hooks.afterToolCall) {
        await hooks.afterToolCall(context, toolName, input, output, success);
      }
    },
  };
}

/**
 * Updates execution metrics on the provided metrics object and emits the update event.
 *
 * @param events - Agent event emitter / エージェントイベントエミッター
 * @param metrics - Mutable metrics object / 変更可能なメトリクスオブジェクト
 * @param updates - Partial updates to apply / 適用する部分更新
 */
export function updateMetrics(
  events: AgentEventEmitter,
  metrics: ExecutionMetrics | null,
  updates: Partial<ExecutionMetrics>,
): void {
  if (metrics) {
    Object.assign(metrics, updates);
    events.emitMetricsUpdate(updates);
  }
}
