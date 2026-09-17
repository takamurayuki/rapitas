/**
 * GeminiCliRunner — Process Runner: spawn command construction
 *
 * Builds the platform-specific spawn command string for the Gemini CLI.
 * Split out of gemini-cli-runner.ts (task #968) so the Windows escaping
 * logic is unit-testable without exercising the full spawn/stream/timeout
 * pipeline. Not responsible for spawning, event parsing, or result
 * construction.
 */

import { escapeWindowsShellArg } from '../../../utils/common';

/**
 * Build the final spawn command and args for the given platform.
 *
 * On Windows, `geminiPath` resolves to a `.cmd` shim whose body re-expands
 * `%*` into a second command line that `cmd.exe` parses again, so `args`
 * (unlike `geminiPath` itself) needs the meta-character escape applied
 * twice — see `escapeWindowsShellArg`'s `doubleEscapeMetaChars` parameter.
 */
export function buildSpawnCommand(
  geminiPath: string,
  args: string[],
  isWindows: boolean,
): [string, string[]] {
  if (!isWindows) return [geminiPath, args];

  const argsString = args.map((arg) => escapeWindowsShellArg(arg, true)).join(' ');
  const quotedPath = escapeWindowsShellArg(geminiPath, false);
  return [`chcp 65001 >NUL 2>&1 && ${quotedPath} ${argsString}`, []];
}
