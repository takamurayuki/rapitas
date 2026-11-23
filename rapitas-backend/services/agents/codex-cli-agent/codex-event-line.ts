/**
 * codex-event-line
 *
 * Decides whether one Codex CLI stdout line is a `--json` event or text the
 * agent wrote. Pure; no I/O.
 */

/** A parsed Codex `--json` event: an object with a string `type`. */
export type CodexEventLine = { type: string } & Record<string, unknown>;

/**
 * Parse a stdout line as a Codex event, or return null when it is text.
 *
 * NOTE: Only an object with a string `type` is an event. Treating any valid
 * JSON as one dropped agent text: a comma-less array element such as
 * `    "docs/requirements.md"` (TempoRaid task 1403's plan, four times) and a
 * one-line declaration object `{"version":1,"files":[...]}` (task 1347, an
 * empty json:plan-declaration fence), both on 2026-11-23.
 *
 * @param line - One stdout line / 標準出力の1行
 * @returns The event, or null for text / イベント、テキストなら null
 */
export function parseCodexEventLine(line: string): CodexEventLine | null {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return null;
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
  return typeof (json as { type?: unknown }).type === 'string' ? (json as CodexEventLine) : null;
}
