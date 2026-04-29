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
/**
 * One sub-question inside a multi-question AskUserQuestion call.
 * Each gets its own header / options / multiSelect so the UI can step
 * through them one at a time, Claude-WebUI style.
 */
export type SubQuestion = {
  header?: string;
  question: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
};

export type QuestionDetails = {
  headers?: string[];
  options?: Array<{
    label: string;
    description?: string;
  }>;
  multiSelect?: boolean;
  /**
   * Full sequenced sub-question list. Populated when the agent emits a
   * `questions` array with multiple entries; the UI renders these one
   * at a time and concatenates answers when sending back to the agent.
   */
  questions?: SubQuestion[];
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
