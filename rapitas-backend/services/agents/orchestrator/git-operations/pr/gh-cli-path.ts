/**
 * GitOperations — GitHub CLI Path Resolution
 *
 * Resolves the platform-appropriate `gh` executable path.
 * Not responsible for invoking gh commands.
 */

// NOTE: UNQUOTED — execFile takes the executable as a separate array element
// from its args and does not go through a shell, so a path with spaces needs
// no quoting (quoting is a shell concept; quotes here would become literal
// characters in the path and fail to spawn).
const GH_PATH_WIN = 'C:\\Program Files\\GitHub CLI\\gh.exe';

/**
 * Resolve the path to the GitHub CLI for the current platform.
 *
 * @returns Platform-appropriate gh CLI executable path / プラットフォームに適したgh CLI実行パス
 */
export function ghPath(): string {
  return process.platform === 'win32' ? GH_PATH_WIN : 'gh';
}
