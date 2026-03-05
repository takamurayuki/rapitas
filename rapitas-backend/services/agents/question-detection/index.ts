/**
 * 質問判定システム - キーベース判定方式
 *
 * AIエージェントからの質問を構造化されたキーフォーマットで判定・管理する
 * パターンマッチングから特定キー返却方式への移行を実現
 */

// 型定義
export type {
  QuestionStatus,
  QuestionCategory,
  QuestionDetectionMethod,
  QuestionKey,
  QuestionDetails,
  QuestionDetectionResult,
  QuestionWaitingState,
} from "./types";

// 定数
export {
  DEFAULT_QUESTION_TIMEOUT_SECONDS,
  MIN_QUESTION_TIMEOUT_SECONDS,
  MAX_QUESTION_TIMEOUT_SECONDS,
} from "./constants";

// コア検出ロジック
export {
  generateQuestionId,
  inferQuestionCategory,
  extractQuestionInfo,
  createQuestionKeyFromToolCall,
  detectQuestionFromToolCall,
  createInitialWaitingState,
  updateWaitingStateFromDetection,
} from "./detection";

// タイムアウト管理
export {
  normalizeTimeoutSeconds,
  calculateTimeoutDeadline,
  isQuestionTimedOut,
  getRemainingTimeoutSeconds,
} from "./timeout";

// バリデーション & パース
export {
  validateQuestionKey,
  parseQuestionKeyFromString,
  extractQuestionKeyFromObject,
} from "./validation";

// 後方互換性レイヤー
export {
  tolegacyQuestionType,
  toExecutionResultFormat,
} from "./legacy";
