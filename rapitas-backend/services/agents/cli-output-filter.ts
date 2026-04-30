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

const BENIGN_DIAGNOSTIC_PATTERNS = [
  /codex_core::session: failed to record rollout/i,
  /failed to record rollout/i,
  /failed to clean up stale arg0 temp dirs/i,
  /proceeding, even though we could not update PATH/i,
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

const DIFF_OR_CODE_PATTERNS = [
  /^(import|export|const|let|function|class|interface|type|return|if|else|try|catch)\b/,
  /^[A-Za-z0-9_$]+\.(error|warn|info|debug|log)\(/,
  /^[A-Za-z0-9_$.[\]'"`]+\s*[:=]/,
  /^<\/?[A-Za-z][^>]*>/,
  /^[+\- ]{1,3}(import|export|const|let|function|class|interface|type|return|if|else|try|catch)\b/,
  /^[+\- ]{1,3}[A-Za-z0-9_$.[\]'"`]+\s*[:=]/,
  /^[+\- ]{1,3}<\/?[A-Za-z][^>]*>/,
  /^[+\- ]{1,3}[})\];,]+$/,
  /^[+\- ]{1,3}\/\/ /,
  /^[+\- ]{1,3}\/\*/,
  /^[+\- ]{1,3}\* /,
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

    const stripped = stripCliLabels(trimmed);
    const candidate = stripped || trimmed;

    if (
      isBenignDiagnostic(candidate) ||
      isNoiseLine(candidate) ||
      isFilePathListLine(candidate) ||
      isGrepMatchLine(candidate) ||
      isDiffHunkLine(candidate) ||
      isDiffOrCodeLine(candidate) ||
      isBracketOnlyLine(candidate)
    ) {
      omittedLines++;
      continue;
    }

    if (IMPORTANT_PATTERNS.some((pattern) => pattern.test(candidate))) {
      displayLines.push(truncateLine(trimmed));
      continue;
    }

    if (COMMAND_PATTERNS.some((pattern) => pattern.test(candidate))) {
      displayLines.push(`[Command] ${truncateLine(trimmed)}`);
      continue;
    }

    omittedLines++;
  }

  if (displayLines.length === 0 && omittedLines > 0) {
    return { display: '', important: false };
  }

  const display = displayLines.join('\n');

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

  // NOTE: Strip codex/CLI labels (`$ ` shell echo, `調査:` / `Investigation:`
  // tool labels) so the inner heuristics see the actual content. Otherwise a
  // line like `調査: { foo }` slips past the bracket / code filter because of
  // the prefix. The IMPORTANT-keyword exception still applies after stripping.
  const stripped = stripCliLabels(trimmed);
  const candidate = stripped || trimmed;

  if (
    isBenignDiagnostic(candidate) ||
    isNoiseLine(candidate) ||
    isFilePathListLine(candidate) ||
    isGrepMatchLine(candidate) ||
    isDiffHunkLine(candidate) ||
    isDiffOrCodeLine(candidate) ||
    isBracketOnlyLine(candidate)
  ) {
    return true;
  }
  if (/^[{[}"'`]|[{};]$/.test(candidate) && !IMPORTANT_PATTERNS.some((p) => p.test(candidate))) {
    return true;
  }
  // NOTE: A bare codex tool label (e.g. `調査:`, `Investigation:`) with code-like
  // body is noise. If stripping the label leaves something short and not
  // important-looking, hide it.
  if (
    stripped &&
    stripped !== trimmed &&
    stripped.length < 60 &&
    !IMPORTANT_PATTERNS.some((p) => p.test(stripped))
  ) {
    return true;
  }
  return false;
}

/**
 * Remove codex/CLI prefix labels so heuristics can inspect the real content.
 * Preserves the rest of the line verbatim.
 */
function stripCliLabels(line: string): string {
  return line
    .replace(/^\$\s+/, '')
    .replace(/^(?:調査|investigation|research|exec|run|execute|tool):\s+/i, '')
    .trim();
}

function isNoiseLine(line: string): boolean {
  return NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

function isDiffOrCodeLine(line: string): boolean {
  return DIFF_OR_CODE_PATTERNS.some((pattern) => pattern.test(line));
}

function isDiffHunkLine(line: string): boolean {
  return /^[+-](?![+-]{2}\s)/.test(line);
}

/**
 * True when the line is essentially just brackets / punctuation (e.g. `}`,
 * `} catch (error) {`, `/* error *​/`). These show up when an agent dumps code
 * excerpts — useful in a code review, but pure noise in a live execution log.
 */
function isBracketOnlyLine(line: string): boolean {
  if (/^\s*[{}()\[\];,]+\s*$/.test(line)) return true;
  if (/^\s*\/[*\/]/.test(line)) return true; // `/* ... */` or `// ...`
  if (/^\s*\}\s*(?:catch|finally|else|while)\b/.test(line)) return true;
  if (/^\s*\}\s*\)?[,;]?\s*$/.test(line)) return true;
  return false;
}

function isFilePathListLine(line: string): boolean {
  const candidate = line.replace(/^\$\s+/, '').trim();
  if (candidate.includes(' ')) return false;
  if (!/[\\/]/.test(candidate)) return false;
  return /^(?:[A-Za-z]:[\\/])?[\w@()[\].-]+(?:[\\/][\w@()[\].-]+)+$/.test(candidate);
}

/**
 * Detects grep-style line output dumped by codex/claude when the agent runs
 * `grep -n` or similar. Format: `<path>:<lineno>:<content>`, optionally prefixed
 * with `$ ` (CLI echo) or `調査: ` / `Investigation: ` (research label).
 *
 * These lines flood execution logs when an agent grep's a large file
 * (e.g., bun.lock, pnpm-lock.yaml, generated SQL).
 */
function isGrepMatchLine(line: string): boolean {
  // NOTE: Caller already stripped `$ ` and tool labels via stripCliLabels, but
  // accept either form here for robustness when invoked directly.
  const candidate = line
    .replace(/^\$\s+/, '')
    .replace(/^(?:調査|investigation|research):\s+/i, '')
    .trim();
  return /^(?:[A-Za-z]:[\\/])?[\w@()[\].-]+(?:[\\/][\w@()[\].-]+)*:\d+:/.test(candidate);
}

function isBenignDiagnostic(line: string): boolean {
  return BENIGN_DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(line));
}

function truncateLine(line: string): string {
  return line.length > MAX_DISPLAY_LINE_CHARS
    ? `${line.slice(0, MAX_DISPLAY_LINE_CHARS - 3)}...`
    : line;
}
