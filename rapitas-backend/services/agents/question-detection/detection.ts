/**
 * Question Detection System - Core Detection Logic
 *
 * Detects and manages questions from AI agents using structured key format.
 */

import type {
  QuestionCategory,
  QuestionDetails,
  QuestionDetectionResult,
  QuestionKey,
  QuestionWaitingState,
} from './types';
import { normalizeTimeoutSeconds } from './timeout';

/**
 * Generates a unique question ID.
 */
export function generateQuestionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `q_${timestamp}_${random}`;
}

/**
 * Infers question category from AskUserQuestion tool input.
 */
export function inferQuestionCategory(
  input: Record<string, unknown> | undefined,
): QuestionCategory {
  if (!input) {
    return 'clarification';
  }

  const questions = input.questions as
    | Array<{
        options?: unknown[];
        multiSelect?: boolean;
        question?: string;
      }>
    | undefined;

  if (questions && Array.isArray(questions) && questions.length > 0) {
    const firstQuestion = questions[0];

    // Has options -> selection type
    if (
      firstQuestion?.options &&
      Array.isArray(firstQuestion.options) &&
      firstQuestion.options.length > 0
    ) {
      return 'selection';
    }

    // Contains confirmation keywords -> confirmation type
    const questionText = firstQuestion?.question || '';
    const confirmationKeywords = [
      'よろしいですか',
      'してもいいですか',
      'しますか',
      '続けますか',
      '確認',
      'proceed',
      'continue',
      'confirm',
      'ok',
      'yes',
      'no',
    ];

    const isConfirmation = confirmationKeywords.some((keyword) =>
      questionText.toLowerCase().includes(keyword.toLowerCase()),
    );

    if (isConfirmation) {
      return 'confirmation';
    }
  }

  return 'clarification';
}

/**
 * Extracts question info from AskUserQuestion tool input.
 * Maintains backward compatibility with ClaudeCodeAgent.extractQuestionInfo.
 */
export function extractQuestionInfo(input: Record<string, unknown> | undefined): {
  questionText: string;
  questionDetails?: QuestionDetails;
} {
  if (!input) {
    return { questionText: '' };
  }

  let questionText = '';
  const questionDetails: QuestionDetails = {};

  if (input.questions && Array.isArray(input.questions)) {
    const questions = input.questions as Array<{
      question?: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      multiSelect?: boolean;
    }>;

    questionText = questions
      .map((q) => q.question || q.header || '')
      .filter((q) => q)
      .join('\n');

    const headers = questions.map((q) => q.header).filter((h): h is string => !!h);
    if (headers.length > 0) {
      questionDetails.headers = headers;
    }

    // Preserve every sub-question (header / question / options / multiSelect)
    // so the frontend can step through them one at a time. Previously only
    // the first question's options were kept and the rest were lost.
    questionDetails.questions = questions
      .filter((q) => (q.question || q.header || '').trim().length > 0)
      .map((q) => ({
        header: q.header,
        question: q.question || q.header || '',
        options: Array.isArray(q.options)
          ? q.options.map((opt) => ({
              label: opt.label || '',
              description: opt.description,
            }))
          : undefined,
        multiSelect: typeof q.multiSelect === 'boolean' ? q.multiSelect : undefined,
      }));

    const firstQuestion = questions[0];
    if (firstQuestion) {
      if (firstQuestion.options && Array.isArray(firstQuestion.options)) {
        questionDetails.options = firstQuestion.options.map((opt) => ({
          label: opt.label || '',
          description: opt.description,
        }));
      }
      if (typeof firstQuestion.multiSelect === 'boolean') {
        questionDetails.multiSelect = firstQuestion.multiSelect;
      }
    }
  } else if (input.question && typeof input.question === 'string') {
    questionText = input.question;
  }

  const hasDetails =
    questionDetails.headers?.length ||
    questionDetails.options?.length ||
    questionDetails.multiSelect !== undefined;

  return {
    questionText,
    questionDetails: hasDetails ? questionDetails : undefined,
  };
}

/**
 * Creates a structured question key from an AskUserQuestion tool call.
 */
export function createQuestionKeyFromToolCall(
  input: Record<string, unknown> | undefined,
  timeoutSeconds?: number,
): QuestionKey {
  const normalizedTimeout = normalizeTimeoutSeconds(timeoutSeconds);

  return {
    status: 'awaiting_user_input',
    question_id: generateQuestionId(),
    question_type: inferQuestionCategory(input),
    requires_response: true,
    timeout_seconds: normalizedTimeout,
  };
}

/**
 * Builds a complete detection result from an AskUserQuestion tool call.
 */
export function detectQuestionFromToolCall(
  toolName: string,
  input: Record<string, unknown> | undefined,
  timeoutSeconds?: number,
): QuestionDetectionResult {
  if (toolName !== 'AskUserQuestion') {
    return {
      hasQuestion: false,
      questionText: '',
      detectionMethod: 'none',
    };
  }

  const { questionText, questionDetails } = extractQuestionInfo(input);

  const questionKey = createQuestionKeyFromToolCall(input, timeoutSeconds);

  return {
    hasQuestion: true,
    questionText: questionText || 'ユーザーの入力を待っています',
    questionKey,
    questionDetails,
    detectionMethod: 'tool_call',
  };
}

/**
 * Creates an initial (empty) question waiting state.
 */
export function createInitialWaitingState(): QuestionWaitingState {
  return {
    hasQuestion: false,
    question: '',
    questionType: 'none',
  };
}

/**
 * Updates waiting state from a detection result.
 */
export function updateWaitingStateFromDetection(
  result: QuestionDetectionResult,
): QuestionWaitingState {
  if (!result.hasQuestion) {
    return createInitialWaitingState();
  }

  return {
    hasQuestion: true,
    question: result.questionText,
    questionType: result.detectionMethod,
    questionDetails: result.questionDetails,
    questionKey: result.questionKey,
  };
}
