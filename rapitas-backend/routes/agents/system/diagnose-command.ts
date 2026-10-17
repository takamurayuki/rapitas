/**
 * Diagnose Command
 *
 * Builds the spawn target and argv for the diagnose route's Claude CLI
 * probes, applying the Windows quoting those probes need.
 * Not responsible for spawning the process or for reading its output.
 */

import {
  escapeWindowsShellArg,
  escapeWindowsShellArgForTarget,
} from '../../../utils/common/windows-shell-escape';

/**
 * Build the `[command, args]` pair for a Claude CLI probe.
 *
 * The caller spawns the result with `shell: isWindows`. Off Windows there is
 * no shell and no quoting problem: argv reaches the program as given. On
 * Windows a shell is unavoidable, because the installed `claude` is usually a
 * `.cmd` shim that `CreateProcess` cannot execute directly — so the command
 * line is built here rather than by Node, which does not quote at all under
 * `shell: true`.
 *
 * `claudePath` comes from `CLAUDE_CODE_PATH`, which is why it is never
 * interpolated raw (CodeQL js/indirect-command-line-injection): it is wrapped
 * in REAL quotes, the form cmd.exe needs to read a path containing a space as
 * one command name, and which already neutralises `&`, `|`, `<`, `>`. The
 * arguments instead get caret escaping to the depth the target demands —
 * twice through a `.cmd` shim, whose `%*` re-expansion is parsed a second
 * time, once for a native `claude.exe`, which would otherwise receive
 * `^--print^` (task 970).
 *
 * @param claudePath - Resolved CLI path or bare name / 解決済み CLI パスまたは名前
 * @param args - Arguments to pass to the CLI / CLI に渡す引数
 * @param isWindows - Whether the host is Windows / ホストが Windows かどうか
 * @returns Spawn command and argv / spawn に渡すコマンドと引数配列
 */
export function buildClaudeProbeSpawn(
  claudePath: string,
  args: string[],
  isWindows: boolean,
): [string, string[]] {
  if (!isWindows) return [claudePath, args];

  const escapedArgs = args.map((arg) => escapeWindowsShellArgForTarget(claudePath, arg)).join(' ');
  return [`${escapeWindowsShellArg(claudePath, false)} ${escapedArgs}`, []];
}
