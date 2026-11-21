/**
 * codex-cli-agent/command-display
 *
 * Turns the raw command string Codex reports for a command_execution item into
 * the short form shown in the execution log, matching how Claude Code runs are
 * shown (`$ <command>` on one line). Display only — the raw string is still
 * what the backend log and the command evidence record.
 *
 * NOTE: Codex reports the full shell invocation, e.g.
 * `"C:\\WINDOWS\\...\\powershell.exe" -Command '<script>'`. Logged as-is, the
 * task 1519 verifier log was 55k characters against 4k for the Claude Code run
 * of the same task (2026-11-21).
 */

/** Longest command text shown on one log line. */
export const MAX_COMMAND_DISPLAY_CHARS = 160;

/** Shell wrappers whose argument is the command the agent actually ran. */
const WRAPPERS: readonly RegExp[] = [
  /^(?:"[^"]*?(?:powershell|pwsh)(?:\.exe)?"|\S*?(?:powershell|pwsh)(?:\.exe)?)\s+(?:-\w+\s+)*?-(?:Command|c)\s+/i,
  /^(?:"[^"]*?bash(?:\.exe)?"|\S*?bash(?:\.exe)?)\s+-l?c\s+/i,
  /^(?:"[^"]*?cmd(?:\.exe)?"|\S*?cmd(?:\.exe)?)\s+(?:\/\w\s+)*?\/c\s+/i,
];

/** Remove one pair of surrounding quotes and undo POSIX `'"'"'` splicing. */
function unquote(arg: string): string {
  const s = arg.trim();
  const q = s[0];
  if ((q === '"' || q === "'") && s.endsWith(q) && s.length >= 2) {
    const inner = s.slice(1, -1);
    return q === "'" ? inner.replace(/'"'"'/g, "'") : inner;
  }
  return s;
}

/**
 * Short, one-line form of a Codex command for the execution log.
 *
 * @param raw - Command string from the Codex JSON event / Codex のイベントにあるコマンド文字列
 * @returns The inner command, first line only, capped in length / 表示用に短くしたコマンド
 */
export function displayCommand(raw: string): string {
  let cmd = raw.trim();
  for (const re of WRAPPERS) {
    const m = cmd.match(re);
    if (m) {
      cmd = unquote(cmd.slice(m[0].length));
      break;
    }
  }
  const lines = cmd.split(/\r?\n/).map((l) => l.trim());
  const first = lines.find((l) => l.length > 0) ?? '';
  const cut = lines.filter((l) => l.length > 0).length > 1;
  if (first.length > MAX_COMMAND_DISPLAY_CHARS) {
    return `${first.slice(0, MAX_COMMAND_DISPLAY_CHARS)} …`;
  }
  return cut ? `${first} …` : first;
}
