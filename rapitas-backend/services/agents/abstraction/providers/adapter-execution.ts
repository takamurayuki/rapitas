/**
 * Adapter Execution Helpers
 *
 * Builds legacy ClaudeCodeAgent configs and tasks from abstraction-layer inputs.
 * Not responsible for state transitions or event emission.
 */

import type {
  AgentExecutionContext,
  AgentTaskDefinition,
  ContinuationContext,
  ClaudeCodeProviderConfig,
  PendingQuestion,
} from '../types';
import { ClaudeCodeAgent, ClaudeCodeAgentConfig } from '../../claude-code-agent';
import type { AgentTask } from '../../base-agent';

/**
 * Builds a ClaudeCodeAgentConfig for a fresh execution.
 *
 * @param context - Execution context from the abstraction layer / 抽象化レイヤーの実行コンテキスト
 * @param config - Provider-level defaults / プロバイダーレベルのデフォルト設定
 * @returns ClaudeCodeAgentConfig for the legacy agent / レガシーエージェント向け設定
 */
export function buildLegacyConfig(
  context: AgentExecutionContext,
  config: ClaudeCodeProviderConfig,
): ClaudeCodeAgentConfig {
  return {
    workingDirectory: context.workingDirectory,
    timeout: context.timeout || config.defaultTimeout || 900000,
    dangerouslySkipPermissions:
      context.dangerouslySkipPermissions || config.dangerouslySkipPermissions,
    continueConversation: !!context.sessionId,
    resumeSessionId: context.sessionId,
  };
}

/**
 * Builds a ClaudeCodeAgentConfig for a continuation (--continue) execution.
 *
 * @param context - Execution context / 実行コンテキスト
 * @param config - Provider-level defaults / プロバイダーレベルのデフォルト設定
 * @param continuation - Continuation context carrying session and response / 継続コンテキスト
 * @param currentSessionId - The session ID held by the adapter instance / アダプターが保持するセッションID
 * @returns ClaudeCodeAgentConfig with continueConversation=true / 継続フラグ付き設定
 */
export function buildContinuationConfig(
  context: AgentExecutionContext,
  config: ClaudeCodeProviderConfig,
  continuation: ContinuationContext,
  currentSessionId: string | null,
): ClaudeCodeAgentConfig {
  return {
    workingDirectory: context.workingDirectory,
    timeout: context.timeout || config.defaultTimeout || 900000,
    dangerouslySkipPermissions:
      context.dangerouslySkipPermissions || config.dangerouslySkipPermissions,
    continueConversation: true,
    resumeSessionId: continuation.sessionId || currentSessionId || undefined,
  };
}

/**
 * Converts an abstraction-layer task definition to a legacy AgentTask.
 *
 * @param task - Task definition from the abstraction layer / 抽象化レイヤーのタスク定義
 * @param context - Execution context / 実行コンテキスト
 * @returns Legacy AgentTask compatible with ClaudeCodeAgent / ClaudeCodeAgent互換のレガシータスク
 */
export function buildLegacyTask(
  task: AgentTaskDefinition,
  context: AgentExecutionContext,
): AgentTask {
  // NOTE: Convert string ID to number since the legacy API expects number type
  const taskId = typeof task.id === 'string' ? parseInt(task.id, 10) || 0 : task.id;

  return {
    id: taskId,
    title: task.title,
    description: task.description,
    workingDirectory: context.workingDirectory,
    optimizedPrompt: task.optimizedPrompt,
    analysisInfo: task.analysis
      ? {
          summary: task.analysis.summary,
          complexity: task.analysis.complexity,
          estimatedTotalHours: task.analysis.estimatedDuration
            ? task.analysis.estimatedDuration / 60
            : 0,
          subtasks:
            task.analysis.subtasks?.map((st) => ({
              order: st.order,
              title: st.title,
              description: st.description,
              estimatedHours: st.estimatedDuration ? st.estimatedDuration / 60 : 0,
              priority: st.priority,
              dependencies: st.dependencies,
            })) || [],
          reasoning: '',
          tips: task.analysis.tips || [],
        }
      : undefined,
  };
}

/**
 * Builds a legacy AgentTask for a continuation (user response) execution.
 *
 * @param continuation - Continuation context with user response / ユーザー応答を含む継続コンテキスト
 * @param context - Execution context / 実行コンテキスト
 * @returns Minimal AgentTask representing the user reply / ユーザー返答を表す最小限のタスク
 */
export function buildContinuationTask(
  continuation: ContinuationContext,
  context: AgentExecutionContext,
): AgentTask {
  // NOTE: Convert string previousExecutionId to number for legacy API
  const taskId =
    typeof continuation.previousExecutionId === 'string'
      ? parseInt(continuation.previousExecutionId, 10) || 0
      : 0;

  return {
    id: taskId,
    title: 'User Response',
    description: continuation.userResponse || '',
    workingDirectory: context.workingDirectory,
  };
}

/**
 * Attaches the question-detected handler to a legacy ClaudeCodeAgent.
 *
 * @param agent - The legacy agent instance / レガシーエージェントインスタンス
 * @param context - Execution context for timeout calculation / タイムアウト計算用の実行コンテキスト
 * @param onQuestion - Callback invoked when a question is detected / 質問検出時のコールバック
 */
export function attachQuestionHandler(
  agent: ClaudeCodeAgent,
  context: AgentExecutionContext,
  onQuestion: (q: PendingQuestion) => void,
): void {
  agent.setQuestionDetectedHandler((info) => {
    const question: PendingQuestion = {
      questionId: info.questionKey?.question_id || `q-${Date.now()}`,
      text: info.question,
      category: mapLegacyQuestionType(info.questionType),
      options: info.questionDetails?.options?.map((opt) => ({
        label: opt.label,
        value: opt.label,
        description: opt.description,
      })),
      multiSelect: info.questionDetails?.multiSelect,
      timeout: context.timeout ? Math.floor(context.timeout / 1000) : 300,
    };
    onQuestion(question);
  });
}

/**
 * Maps a legacy question type string to the abstraction category.
 *
 * @param legacyType - Legacy type string / レガシー型文字列
 * @returns Normalized category / 正規化されたカテゴリ
 */
function mapLegacyQuestionType(
  legacyType: string,
): 'clarification' | 'confirmation' | 'selection' | 'input' {
  switch (legacyType) {
    case 'clarification':
      return 'clarification';
    case 'confirmation':
      return 'confirmation';
    case 'selection':
      return 'selection';
    default:
      return 'input';
  }
}
