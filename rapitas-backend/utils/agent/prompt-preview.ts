/**
 * PromptPreview
 *
 * Formats the "prompt sent to the agent" banner that CLI runners echo into the
 * execution output stream. The preview MUST be a single line: the execution
 * log is classified line by line, and only the first line carries the
 * `[Provider] Prompt:` tag — any continuation line of a multi-line preview is
 * untagged and gets rendered as the agent's own narrative, which made system
 * instructions ("あなたは…リサーチャーです。") look like agent speech.
 * Not responsible for what the frontend does with the tagged line.
 */

/** Characters of prompt text kept in the banner. */
export const PROMPT_PREVIEW_MAX_CHARS = 200;

/**
 * Build a one-line preview of a prompt for the execution output banner.
 *
 * Leading markdown heading lines ("## システム指示", "## System
 * Instructions") are structural and dropped so the preview starts with the
 * instruction itself; all remaining whitespace runs (including newlines)
 * collapse to single spaces.
 *
 * @param prompt - Full prompt text handed to the agent / エージェントに渡す全文
 * @param maxChars - Preview length cap / プレビュー文字数上限
 * @returns Single-line preview, "..." appended when truncated / 1行プレビュー
 */
export function formatPromptPreview(
  prompt: string,
  maxChars: number = PROMPT_PREVIEW_MAX_CHARS,
): string {
  const lines = prompt.split(/\r?\n/);
  let start = 0;
  while (start < lines.length && (lines[start].trim() === '' || /^#{1,6}\s/.test(lines[start]))) {
    start += 1;
  }
  const body = lines.slice(start).join(' ').replace(/\s+/g, ' ').trim();
  return body.length > maxChars ? `${body.slice(0, maxChars)}...` : body;
}
