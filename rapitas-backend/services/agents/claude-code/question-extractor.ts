/**
 * ClaudeCodeAgent Question Extractor
 *
 * Parses AskUserQuestion tool call inputs to extract question text and structured options.
 * Not responsible for process management or question state transitions.
 */

import type { QuestionDetails } from '../question-detection';

/**
 * Extracts question text and structured details from an AskUserQuestion tool call input object.
 *
 * @param input - Raw tool call input from the Claude Code CLI / Claude Code CLIからのツール呼び出し入力
 * @returns Parsed question text and optional structured details / 解析された質問テキストとオプションの構造化詳細
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

  // Array format: questions field
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
  }
  // Single question field format
  else if (input.question && typeof input.question === 'string') {
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
