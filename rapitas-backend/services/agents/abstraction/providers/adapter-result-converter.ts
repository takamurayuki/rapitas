/**
 * Adapter Result Converter
 *
 * Converts legacy ClaudeCodeAgent execution results into the IAgent abstraction layer format.
 * Not responsible for agent lifecycle or state management.
 */

import type {
  AgentState,
  AgentExecutionContext,
  AgentExecutionResult,
  PendingQuestion,
  ExecutionMetrics,
} from '../types';
import { AgentError } from '../interfaces';
import type { AgentExecutionResult as LegacyExecutionResult } from '../../base-agent';

/**
 * Maps a legacy question type string to the abstraction layer category.
 *
 * @param legacyType - Legacy question type from ClaudeCodeAgent / レガシー質問タイプ
 * @returns Normalized category for the abstraction layer / 正規化されたカテゴリ
 */
export function mapQuestionType(
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

/**
 * Converts a legacy execution result to the new AgentExecutionResult shape.
 *
 * @param legacyResult - Result from the legacy ClaudeCodeAgent / レガシーエージェントの結果
 * @param startTime - Execution start timestamp / 実行開始時刻
 * @param context - Current execution context / 実行コンテキスト
 * @returns Converted result in the abstraction layer format / 抽象化レイヤーの形式に変換された結果
 */
export function convertLegacyResult(
  legacyResult: LegacyExecutionResult,
  startTime: Date,
  context: AgentExecutionContext,
): AgentExecutionResult {
  const endTime = new Date();
  const durationMs = endTime.getTime() - startTime.getTime();

  const metrics: ExecutionMetrics = {
    startTime,
    endTime,
    durationMs,
  };

  let state: AgentState;
  if (legacyResult.waitingForInput) {
    state = 'waiting_for_input';
  } else if (legacyResult.success) {
    state = 'completed';
  } else {
    state = 'failed';
  }

  let pendingQuestion: PendingQuestion | undefined;
  if (legacyResult.waitingForInput && legacyResult.question) {
    pendingQuestion = {
      questionId: legacyResult.questionKey?.question_id || `q-${Date.now()}`,
      text: legacyResult.question,
      category: mapQuestionType(legacyResult.questionType || 'input'),
      options: legacyResult.questionDetails?.options?.map((opt) => ({
        label: opt.label,
        value: opt.label,
        description: opt.description,
      })),
      multiSelect: legacyResult.questionDetails?.multiSelect,
    };
  }

  return {
    success: legacyResult.success,
    state,
    output: legacyResult.output,
    errorMessage: legacyResult.errorMessage,
    artifacts: legacyResult.artifacts?.map((a) => ({
      type: a.type as 'file' | 'code' | 'diff' | 'log' | 'image' | 'data',
      name: a.name,
      content: a.content,
      path: a.path,
    })),
    commits: legacyResult.commits?.map((c) => ({
      hash: c.hash,
      message: c.message,
      branch: c.branch,
      filesChanged: c.filesChanged,
      additions: c.additions,
      deletions: c.deletions,
    })),
    metrics,
    pendingQuestion,
    sessionId: legacyResult.claudeSessionId,
    debugInfo: {
      logs: [],
    },
  };
}

/**
 * Creates a cancelled execution result.
 *
 * @param context - Current execution context / 実行コンテキスト
 * @param reason - Cancellation reason string / キャンセル理由
 * @returns Cancelled AgentExecutionResult / キャンセルされた実行結果
 */
export function createCancelledResult(
  context: AgentExecutionContext,
  reason: string,
): AgentExecutionResult {
  return {
    success: false,
    state: 'cancelled',
    output: '',
    errorMessage: reason,
    debugInfo: {
      logs: [],
    },
  };
}

/**
 * Creates a failed execution result from an AgentError.
 *
 * @param context - Current execution context / 実行コンテキスト
 * @param error - The agent error that caused the failure / 失敗の原因となったエラー
 * @param startTime - Execution start timestamp / 実行開始時刻
 * @returns Failed AgentExecutionResult with timing metrics / タイミングメトリクス付きの失敗結果
 */
export function createErrorResult(
  context: AgentExecutionContext,
  error: AgentError,
  startTime: Date,
): AgentExecutionResult {
  const endTime = new Date();

  return {
    success: false,
    state: 'failed',
    output: '',
    errorMessage: error.message,
    metrics: {
      startTime,
      endTime,
      durationMs: endTime.getTime() - startTime.getTime(),
    },
    debugInfo: {
      logs: [],
    },
  };
}

/**
 * Wraps an unknown thrown value as an AgentError.
 *
 * @param error - The unknown error value / 不明なエラー値
 * @returns Typed AgentError instance / 型付きAgentErrorインスタンス
 */
export function wrapError(error: unknown): AgentError {
  if (error instanceof AgentError) {
    return error;
  }

  if (error instanceof Error) {
    return new AgentError(error.message, 'execution', false, undefined, error);
  }

  return new AgentError(String(error), 'internal', false);
}
