/**
 * ライフサイクルフック定義
 */

import type { AgentState } from './agent-identification';
import type { AgentExecutionContext, AgentTaskDefinition } from './execution-context';
import type { AgentExecutionResult, AgentArtifact, PendingQuestion } from './execution-result';

/**
 * ライフサイクルフック定義
 */
export interface AgentLifecycleHooks {
  /**
   * 実行開始前に呼び出される
   * falseを返すと実行をキャンセル
   */
  beforeExecute?: (
    context: AgentExecutionContext,
    task: AgentTaskDefinition,
  ) => Promise<boolean | void>;

  /**
   * 実行完了後に呼び出される
   */
  afterExecute?: (context: AgentExecutionContext, result: AgentExecutionResult) => Promise<void>;

  /**
   * エラー発生時に呼び出される
   * 戻り値でリトライするかを制御
   */
  onError?: (
    context: AgentExecutionContext,
    error: Error,
    retryCount: number,
  ) => Promise<{ retry: boolean; delay?: number }>;

  /**
   * 質問発生時に呼び出される
   * 自動応答を返すか、nullでユーザー入力を待つ
   */
  onQuestion?: (
    context: AgentExecutionContext,
    question: PendingQuestion,
  ) => Promise<string | null>;

  /**
   * 状態変更時に呼び出される
   */
  onStateChange?: (
    context: AgentExecutionContext,
    previousState: AgentState,
    newState: AgentState,
  ) => Promise<void>;

  /**
   * ツール実行前に呼び出される
   * falseを返すとツール実行をスキップ
   */
  beforeToolCall?: (
    context: AgentExecutionContext,
    toolName: string,
    input: unknown,
  ) => Promise<boolean | void>;

  /**
   * ツール実行後に呼び出される
   */
  afterToolCall?: (
    context: AgentExecutionContext,
    toolName: string,
    input: unknown,
    output: unknown,
    success: boolean,
  ) => Promise<void>;

  /**
   * 成果物生成時に呼び出される
   */
  onArtifact?: (context: AgentExecutionContext, artifact: AgentArtifact) => Promise<void>;

  /**
   * シャットダウン時に呼び出される
   */
  onShutdown?: (
    context: AgentExecutionContext,
    reason: 'completed' | 'cancelled' | 'error' | 'timeout',
  ) => Promise<void>;
}
