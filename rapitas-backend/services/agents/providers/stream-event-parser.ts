/**
 * StreamEventParser
 *
 * Parses individual stream-json events emitted by the Claude Code CLI.
 * Pure transformation — no I/O, no process management.
 */

/** Result of parsing a single stream-json event. */
export interface StreamEventResult {
  output: string;
  sessionId?: string;
  isQuestion?: boolean;
  questionText?: string;
}

/**
 * Extracts output text, session ID, and question info from a single stream-json event object.
 *
 * @param json - Parsed JSON event from the Claude Code stream / Claude Codeストリームからのパース済みJSONイベント
 * @returns Extracted fields from the event / イベントから抽出されたフィールド
 */
export function processStreamEvent(json: Record<string, unknown>): StreamEventResult {
  let output = '';
  let sessionId: string | undefined;
  let isQuestion = false;
  let questionText = '';

  switch (json.type) {
    case 'assistant':
      if (json.message && typeof json.message === 'object') {
        const message = json.message as { content?: unknown[] };
        if (Array.isArray(message.content)) {
          for (const block of message.content) {
            if (typeof block === 'object' && block !== null) {
              const b = block as { type?: string; text?: string; name?: string; input?: unknown };
              if (b.type === 'text' && b.text) {
                output += b.text;
              } else if (b.type === 'tool_use' && b.name === 'AskUserQuestion') {
                isQuestion = true;
                const input = b.input as {
                  questions?: Array<{ question?: string }>;
                } | undefined;
                if (input?.questions?.[0]?.question) {
                  questionText = input.questions[0].question;
                }
                output += `\n[質問] ${questionText}\n`;
              } else if (b.type === 'tool_use') {
                output += `\n[Tool: ${b.name}]\n`;
              }
            }
          }
        }
      }
      break;

    case 'system':
      if (json.subtype === 'init' && json.session_id) {
        sessionId = json.session_id as string;
      }
      break;

    case 'result':
      if (json.result && typeof json.result === 'string') {
        output += `\n[Result: completed]\n${json.result}\n`;
      }
      break;
  }

  return { output, sessionId, isQuestion, questionText };
}
