/**
 * agentExecutionUtils
 *
 * Pure utility functions shared across agent-execution components and the hook.
 * Contains no React dependencies; safe to import anywhere.
 */

/**
 * Format a token count into a human-readable string (K / M suffixes).
 *
 * @param tokens - Raw token count
 * @returns Formatted string, e.g. "1.2K tokens" or "3.4M tokens"
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K tokens`;
  }
  return `${tokens} tokens`;
}

/**
 * Format a remaining-seconds value as mm:ss.
 *
 * @param seconds - Non-negative integer seconds remaining
 * @returns Zero-padded mm:ss string, e.g. "2:05"
 */
export function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parse a question string to extract multiple-choice options, if present.
 * Supports two formats:
 *   1. "Question\nOptions:\nA) ...\nB) ..."
 *   2. "Question?\n1. Option1\n2. Option2"
 *
 * @param questionText - Raw question text from the AI agent
 * @returns Parsed question with text and options, or null if no options detected
 */
/** Parsed question result, optionally with sub-questions for multi-question mode. */
export type ParsedQuestion = {
  text: string;
  options: string[];
  /** Individual sub-questions that each need a yes/no answer. */
  subQuestions?: Array<{ question: string; key: string }>;
  /** Whether this contains multiple questions requiring individual answers. */
  isMultiQuestion?: boolean;
};

/** Check if a line is a Japanese question (ending with ？ even if followed by ...) */
function isJpQuestionLine(line: string): boolean {
  const stripped = line.replace(/[.…。、\s]+$/, '');
  return /[？?]$/.test(stripped) && stripped.length > 5;
}

/** Check if a line contains Japanese question keywords */
function containsJpQuestionKeyword(line: string): boolean {
  return /(?:しますか|ですか|でしょうか|どうしますか|よろしいですか|含めますか|スキップしますか|適用しますか|実行しますか|確認しますか)/.test(
    line,
  );
}

/**
 * Parse question text to extract options or sub-questions.
 * Handles: explicit option lists, numbered lists, Japanese yes/no questions,
 * and multi-line question format with trailing punctuation.
 */
export function parseQuestionOptions(
  questionText: string,
): ParsedQuestion | null {
  if (!questionText) return null;

  // 1. Explicit option list: "Options:\nA) ...\nB) ..."
  const optionsMatch = questionText.match(
    /(?:オプション|Options?|選択肢)[:：]\s*\n((?:[A-D]\)|[①-④]|\d\))[^\n]+\n?)+/i,
  );
  if (optionsMatch) {
    const questionPart = questionText.substring(0, optionsMatch.index).trim();
    const optionLines = optionsMatch[1].split('\n').filter((l) => l.trim());
    const options = optionLines
      .map((line) => line.replace(/^[A-D]\)|^[①-④]|^\d+\)/, '').trim())
      .filter((o) => o);
    if (options.length >= 2) return { text: questionPart, options };
  }

  // 2. Numbered list: "1. Option1\n2. Option2"
  const lines = questionText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const numberedLines = lines.filter((l) => /^\d+[.．、)\]]\s*.+/.test(l));
  if (numberedLines.length >= 2) {
    const nonNumbered = lines.filter((l) => !numberedLines.includes(l));
    return {
      text: nonNumbered.join('\n'),
      options: numberedLines.map((l) => l.replace(/^\d+[.．、)\]]\s*/, '')),
    };
  }

  // 3. Multiple Japanese yes/no questions
  const jpQuestionLines = lines.filter(
    (l) => isJpQuestionLine(l) || containsJpQuestionKeyword(l),
  );
  if (jpQuestionLines.length >= 2) {
    const contextLines = lines.filter((l) => !jpQuestionLines.includes(l));
    return {
      text: contextLines.join('\n') || jpQuestionLines[0],
      options: ['はい（すべて）', 'いいえ（すべて）', '個別に回答する'],
      subQuestions: jpQuestionLines.map((q, i) => ({
        question: q.replace(/[.…]+$/, ''),
        key: `q${i}`,
      })),
      isMultiQuestion: true,
    };
  }

  // 4. Single Japanese yes/no question
  if (
    jpQuestionLines.length === 1 ||
    isJpQuestionLine(questionText.trim()) ||
    containsJpQuestionKeyword(questionText)
  ) {
    return {
      text: questionText,
      options: ['はい', 'いいえ'],
    };
  }

  // 5. English yes/no / confirm patterns
  if (
    /\b(yes|no|confirm|would you like|do you want|should I)\b/i.test(
      questionText,
    )
  ) {
    return {
      text: questionText,
      options: ['Yes', 'No'],
    };
  }

  // 6. Fallback: any multi-line text with 2+ lines containing ?
  const anyQuestionLines = lines.filter((l) => /[？?]/.test(l) && l.length > 5);
  if (anyQuestionLines.length >= 2) {
    const contextLines = lines.filter((l) => !anyQuestionLines.includes(l));
    return {
      text: contextLines.join('\n'),
      options: ['はい（すべて）', 'いいえ（すべて）', '個別に回答する'],
      subQuestions: anyQuestionLines.map((q, i) => ({
        question: q,
        key: `q${i}`,
      })),
      isMultiQuestion: true,
    };
  }

  return null;
}
