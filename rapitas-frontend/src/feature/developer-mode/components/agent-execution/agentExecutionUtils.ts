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
export function parseQuestionOptions(
  questionText: string,
): { text: string; options: string[] } | null {
  if (!questionText) return null;

  // Match format: "Question text\nOptions:\nA) Option 1\nB) Option 2\n..."
  const optionsMatch = questionText.match(
    /(?:オプション|Options?|選択肢)[:：]\s*\n((?:[A-D]\)|[①-④]|\d\))[^\n]+\n?)+/i,
  );

  if (!optionsMatch) {
    // Alternative format: "Question?\n1. Option1\n2. Option2"
    const numMatch = questionText.match(/\n(\d+[.．、]\s*[^\n]+(\n|$))+/);
    if (numMatch) {
      const lines = questionText.split('\n');
      const optionLines: string[] = [];
      let questionPart = '';
      let inOptions = false;

      for (const line of lines) {
        if (/^\d+[.．、]\s*.+/.test(line.trim())) {
          inOptions = true;
          optionLines.push(line.trim());
        } else if (inOptions) {
          break;
        } else {
          questionPart += line + '\n';
        }
      }

      if (optionLines.length >= 2) {
        return {
          text: questionPart.trim(),
          options: optionLines.map((l) => l.replace(/^\d+[.．、]\s*/, '')),
        };
      }
    }
    return null;
  }

  const questionPart = questionText.substring(0, optionsMatch.index).trim();
  const optionsPart = optionsMatch[1];
  const optionLines = optionsPart.split('\n').filter((l) => l.trim());

  const options = optionLines
    .map((line) => {
      // Remove prefix like "A)", "1)", "①"
      return line.replace(/^[A-D]\)|^[①-④]|^\d+\)/, '').trim();
    })
    .filter((o) => o);

  if (options.length < 2) return null;

  return { text: questionPart, options };
}
