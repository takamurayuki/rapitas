/**
 * codex-cli-spawn-argv
 *
 * Recovers the logical Codex CLI argv from what `spawn` received, so tests can
 * judge a call (`exec`, `--version`, `login status`) the same way on every OS.
 * Test support only: production never reads argv back, and nothing here
 * launches a process.
 */
import { windowsShellEscapeLayersFor } from '../common/windows-shell-escape';

// NOTE: Must mirror the prefix buildCodexSpawnCommand puts before the command
// on Windows. The round-trip test fails if the two drift apart.
const WINDOWS_PREFIX = 'chcp 65001 >NUL 2>&1 && ';

const CARET_ESCAPED_META = /\^([()%!^"<>&|;,])/g;
const QUOTED_TOKEN = /"((?:\\.|[^"\\])*)"/g;

/** Undo MSVCRT backslash rules for the inside of one quoted token. */
function unquoteToken(inner: string): string {
  return inner
    .replace(/(\\*)\\"/g, (_m, run: string) => `${run.slice(0, run.length / 2)}"`)
    .replace(/(\\+)$/, (_m, run: string) => run.slice(0, run.length / 2));
}

/**
 * Return the logical argv (without the executable) of a Codex CLI launch.
 *
 * On POSIX `spawn` already receives an argv array, so it is returned as is. On
 * Windows buildCodexSpawnCommand folds everything into one cmd.exe string with
 * an empty array; that string is parsed back by undoing the caret-escape
 * layers and the MSVCRT quoting that windows-shell-escape applied.
 *
 * @param command - First argument given to `spawn` / spawn の第1引数
 * @param args - Second argument given to `spawn` / spawn の第2引数
 * @returns Logical argv without the executable / 実行体を除いた論理 argv
 */
export function recoverCodexArgv(command: string, args: string[]): string[] {
  if (!command.startsWith(WINDOWS_PREFIX)) return args;
  const rest = command.slice(WINDOWS_PREFIX.length);
  // The command name keeps real quotes (layers 0), so it is the one quoted
  // token that carries no caret escaping.
  const name = /^"([^"]*)"/.exec(rest);
  if (!name) return args;
  let argText = rest.slice(name[0].length);
  for (let i = 0; i < windowsShellEscapeLayersFor(name[1]); i += 1) {
    argText = argText.replace(CARET_ESCAPED_META, '$1');
  }
  return [...argText.matchAll(QUOTED_TOKEN)].map((m) => unquoteToken(m[1]));
}
