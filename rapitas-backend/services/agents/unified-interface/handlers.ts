/**
 * イベントハンドラー・コールバックの型定義
 *
 * 出力、質問検出、進捗報告のハンドラーを定義
 */

import type { QuestionType } from '../base-agent';
import type { QuestionDetails, QuestionKey } from '../question-detection';

// ==================== ハンドラー ====================

/**
 * 出力ハンドラー
 */
export type OutputHandler = (output: string, isError?: boolean) => void;

/**
 * 質問情報
 */
export type QuestionInfo = {
  question: string;
  questionType: QuestionType;
  questionDetails?: QuestionDetails;
  questionKey?: QuestionKey;
};

/**
 * 質問検出ハンドラー
 */
export type QuestionHandler = (info: QuestionInfo) => void;

/**
 * 進捗ステージ
 */
export type ProgressStage = 'initializing' | 'analyzing' | 'executing' | 'completing';

/**
 * 進捗情報
 */
export type ProgressInfo = {
  stage: ProgressStage;
  percentage?: number;
  message?: string;
  currentStep?: string;
  totalSteps?: number;
};

/**
 * 進捗ハンドラー
 */
export type ProgressHandler = (progress: ProgressInfo) => void;
