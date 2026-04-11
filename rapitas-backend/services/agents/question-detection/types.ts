/**
 * Question Detection System - Type Definitions
 *
 * Types, interfaces, and enums for question detection and management.
 */

/**
 * Question status
 */
export type QuestionStatus = 'awaiting_user_input' | 'processing' | 'completed';

/**
 * Question category (semantic classification)
 */
export type QuestionCategory = 'clarification' | 'confirmation' | 'selection';

/**
 * Question detection method (technical classification).
 * Maintains backward compatibility with existing QuestionType.
 */
export type QuestionDetectionMethod = 'tool_call' | 'key_based' | 'none';

/**
 * Structured question key format returned by AI agents.
 */
export type QuestionKey = {
  status: QuestionStatus;
  question_id: string;
  question_type: QuestionCategory;
  requires_response: boolean;
  timeout_seconds?: number;
};

/**
 * Question details for UI rendering (options, headers, etc.)
 */
export type QuestionDetails = {
  headers?: string[];
  options?: Array<{
    label: string;
    description?: string;
  }>;
  multiSelect?: boolean;
};

/**
 * Question detection result
 */
export type QuestionDetectionResult = {
  hasQuestion: boolean;
  questionText: string;
  questionKey?: QuestionKey;
  questionDetails?: QuestionDetails;
  detectionMethod: QuestionDetectionMethod;
};

/**
 * Question waiting state for post-detection state management.
 */
export type QuestionWaitingState = {
  hasQuestion: boolean;
  question: string;
  /** Kept for backward compatibility */
  questionType: QuestionDetectionMethod;
  questionDetails?: QuestionDetails;
  questionKey?: QuestionKey;
};
