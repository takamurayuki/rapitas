/**
 * ToolFormatter
 *
 * Helpers for parsing Claude CLI JSON output: formatting tool-use display
 * strings and extracting structured question information from AskUserQuestion
 * tool calls. Does not interact with processes or the file system.
 */

/** Structured metadata extracted from an AskUserQuestion tool call. */
export type QuestionDetails = {
  headers?: string[];
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
};

/**
 * Produce a short human-readable summary of a tool invocation for display.
 *
 * @param toolName - Name of the Claude tool / Claudeツール名
 * @param input - Tool input object / ツール入力オブジェクト
 * @returns One-line display string / 1行の表示文字列
 */
export function formatToolInfo(
  toolName: string,
  input: Record<string, unknown> | undefined,
): string {
  if (!input) return '';

  try {
    switch (toolName) {
      case 'Read':
        return input.file_path ? `-> ${String(input.file_path).split(/[/\\]/).pop()}` : '';
      case 'Write':
        return input.file_path ? `-> ${String(input.file_path).split(/[/\\]/).pop()}` : '';
      case 'Edit':
        return input.file_path ? `-> ${String(input.file_path).split(/[/\\]/).pop()}` : '';
      case 'Glob':
        return input.pattern ? `pattern: ${input.pattern}` : '';
      case 'Grep':
        return input.pattern ? `pattern: ${input.pattern}` : '';
      case 'Bash': {
        const cmd = String(input.command || '');
        return cmd.length > 50 ? `$ ${cmd.substring(0, 50)}...` : `$ ${cmd}`;
      }
      case 'Task':
        return input.description ? String(input.description) : '';
      case 'WebFetch':
        return input.url ? `-> ${String(input.url).substring(0, 40)}...` : '';
      case 'WebSearch':
        return input.query ? `"${input.query}"` : '';
      case 'LSP':
        return input.operation ? String(input.operation) : '';
      default: {
        // NOTE: Serialize object/array values as JSON to avoid "[object Object]"
        const firstKey = Object.keys(input)[0];
        if (firstKey && input[firstKey] != null) {
          const raw = input[firstKey];
          const val = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
          return val.length > 80 ? `${val.substring(0, 80)}...` : val;
        }
        return '';
      }
    }
  } catch {
    return '';
  }
}

/**
 * Extract question text and display details from an AskUserQuestion tool input.
 *
 * @param input - Tool input block / ツール入力ブロック
 * @returns Parsed question text and optional structured details / 質問テキストと構造化詳細
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

  // questions (structured multi-question format)
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
