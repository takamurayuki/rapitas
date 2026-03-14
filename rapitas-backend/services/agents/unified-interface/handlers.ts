/**
 * Event Handler & Callback Type Definitions
 *
 * Defines handlers for output, question detection, and progress reporting.
 */

import type { QuestionType } from '../base-agent';
import type { QuestionDetails, QuestionKey } from '../question-detection';

// ==================== Handlers ====================

/**
 * Output handler
 */
export type OutputHandler = (output: string, isError?: boolean) => void;

/**
 * Question information
 */
export type QuestionInfo = {
  question: string;
  questionType: QuestionType;
  questionDetails?: QuestionDetails;
  questionKey?: QuestionKey;
};

/**
 * Question detection handler
 */
export type QuestionHandler = (info: QuestionInfo) => void;

/**
 * Progress stage
 */
export type ProgressStage = 'initializing' | 'analyzing' | 'executing' | 'completing';

/**
 * Progress information
 */
export type ProgressInfo = {
  stage: ProgressStage;
  percentage?: number;
  message?: string;
  currentStep?: string;
  totalSteps?: number;
};

/**
 * Progress handler
 */
export type ProgressHandler = (progress: ProgressInfo) => void;
