/**
 * 質問判定システム - 後方互換性レイヤー
 */

import type { QuestionDetectionMethod, QuestionDetails, QuestionWaitingState } from './types';

/**
 * 既存のQuestionType型との互換性を維持
 * 'tool_call' | 'none' を返す
 */
export function tolegacyQuestionType(method: QuestionDetectionMethod): 'tool_call' | 'none' {
  if (method === 'tool_call' || method === 'key_based') {
    return 'tool_call';
  }
  return 'none';
}

/**
 * 既存のAgentExecutionResult形式に変換
 */
export function toExecutionResultFormat(state: QuestionWaitingState): {
  waitingForInput: boolean;
  question?: string;
  questionType: 'tool_call' | 'none';
  questionDetails?: QuestionDetails;
} {
  return {
    waitingForInput: state.hasQuestion,
    question: state.hasQuestion ? state.question : undefined,
    questionType: tolegacyQuestionType(state.questionType),
    questionDetails: state.questionDetails,
  };
}
