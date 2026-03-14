/**
 * Question Detection System - Key-Based Detection
 *
 * Detects and manages questions from AI agents using structured key format.
 * Migrated from pattern matching to specific key return approach.
 */

// Types
export type {
  QuestionStatus,
  QuestionCategory,
  QuestionDetectionMethod,
  QuestionKey,
  QuestionDetails,
  QuestionDetectionResult,
  QuestionWaitingState,
} from './types';

// Constants
export {
  DEFAULT_QUESTION_TIMEOUT_SECONDS,
  MIN_QUESTION_TIMEOUT_SECONDS,
  MAX_QUESTION_TIMEOUT_SECONDS,
} from './constants';

// Core detection logic
export {
  generateQuestionId,
  inferQuestionCategory,
  extractQuestionInfo,
  createQuestionKeyFromToolCall,
  detectQuestionFromToolCall,
  createInitialWaitingState,
  updateWaitingStateFromDetection,
} from './detection';

// Timeout management
export {
  normalizeTimeoutSeconds,
  calculateTimeoutDeadline,
  isQuestionTimedOut,
  getRemainingTimeoutSeconds,
} from './timeout';

// Validation & parsing
export {
  validateQuestionKey,
  parseQuestionKeyFromString,
  extractQuestionKeyFromObject,
} from './validation';

// Backward compatibility layer
export { tolegacyQuestionType, toExecutionResultFormat } from './legacy';
