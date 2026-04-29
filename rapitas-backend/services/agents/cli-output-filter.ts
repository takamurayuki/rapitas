/**
 * CLI Output Filter
 *
 * Keeps task-detail execution logs readable for noisy CLIs such as Codex and
 * Gemini. Raw stderr often contains full file contents, command output, and
 * diffs; those are useful for debug files but too expensive and noisy for the
 * live execution log.
 */

const IMPORTANT_PATTERNS = [
  /\b(error|failed|failure|exception|panic|denied|unauthorized|forbidden)\b/i,
  /\b(rate limit|usage limit|quota|timeout|timed out)\b/i,
  /\b(cannot find|not found|no such file|permission denied)\b/i,
  /\b(exit code|exited [1-9]\d*)\b/i,
  /\b(warn|warning)\b/i,
];

const NOISE_PATTERNS = [
  /^Reading additional input from stdin/i,
  /^OpenAI Codex\b/i,
  /^workdir:/i,
  /^sandbox:/i,
  /^model:/i,
  /^approval:/i,
  /^reasoning effort:/i,
  /^codex$/i,
  /^gemini$/i,
  /^exec$/i,
  /^succeeded in \d+/i,
  /^exited 0\b/i,
  /^diff --git /i,
  /^index [a-f0-9]+\.\.[a-f0-9]+/i,
  /^--- /,
  /^\+\+\+ /,
  /^@@ /,
];

const COMMAND_PATTERNS = [
  /\b(Get-Content|Select-String|rg|grep|cat|sed|type|git diff|git show|ls|Get-ChildItem)\b/i,
  /\b(pnpm|npm|bun|cargo|tsc|vitest|prettier)\b/i,
];

/** Maximum chars for a single displayed CLI log line. */
const MAX_DISPLAY_LINE_CHARS = 240;

export type FilteredCliOutput = {
  display: string;
  important: boolean;
};

/**
 * Filter noisy stderr/raw stdout into a compact display string.
 *
 * @param output - Raw chunk from CLI stderr/stdout
 * @param options.provider - Provider label used in summary messages
 * @returns Displayable text and whether it is important enough for error UI
 */
export function filterCliDiagnosticOutput(
  output: string,
  options: { provider: 'codex' | 'gemini' },
): FilteredCliOutput {
  const displayLines: string[] = [];
  let omittedLines = 0;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (IMPORTANT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      displayLines.push(truncateLine(trimmed));
      continue;
    }

    if (NOISE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      omittedLines++;
      continue;
    }

    if (COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      displayLines.push(`[Command] ${truncateLine(trimmed)}`);
      continue;
    }

    omittedLines++;
  }

  if (displayLines.length === 0 && omittedLines > 0) {
    return { display: '', important: false };
  }

  const display =
    displayLines.join('\n') +
    (omittedLines > 0 ? `\n[${options.provider}] hidden ${omittedLines} noisy line(s)` : '');

  return {
    display: display ? `${display}\n` : '',
    important: displayLines.some((line) =>
      IMPORTANT_PATTERNS.some((pattern) => pattern.test(line)),
    ),
  };
}

/**
 * Returns true when a raw non-JSON stdout line is likely an accidental dump of
 * file contents or command output and should be hidden from the live log.
 */
export function shouldHideRawCliLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.length > MAX_DISPLAY_LINE_CHARS) return true;
  if (NOISE_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  if (/^[+\- ]{1,3}(import|export|const|let|function|class|interface|type)\b/.test(trimmed)) {
    return true;
  }
  if (/^[{[}"'`]|[{};]$/.test(trimmed) && !IMPORTANT_PATTERNS.some((p) => p.test(trimmed))) {
    return true;
  }
  return false;
}

function truncateLine(line: string): string {
  return line.length > MAX_DISPLAY_LINE_CHARS
    ? `${line.slice(0, MAX_DISPLAY_LINE_CHARS - 3)}...`
    : line;
}
