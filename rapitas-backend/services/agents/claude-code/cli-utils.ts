/**
 * ClaudeCodeAgent CLI Utilities
 *
 * Platform-specific helpers for resolving and launching the Claude Code CLI binary.
 * Not responsible for process lifecycle management or output parsing.
 */

import { spawn } from 'child_process';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { createLogger } from '../../../config/logger';

const logger = createLogger('claude-code-agent');

// Process-lifetime cache for resolved CLI paths. resolveCliPath runs a `where`
// subprocess and was called several times PER execution (runner + provider +
// stream), repeating the probe — and re-logging "Failed to resolve" 20-40×/day.
// The PATH does not change during a server run, so memoize both hits and the
// fallback. A restart re-probes naturally (cache is module-scoped).
const cliPathCache = new Map<string, string>();

/**
 * Resolves the absolute path of a CLI command on Windows.
 * Falls back to the original path if PATH resolution fails.
 * Memoized for the process lifetime (see cliPathCache).
 *
 * @param cliName - CLI binary name or path to resolve / 解決するCLIバイナリ名またはパス
 * @returns Absolute path on Windows, original name on other platforms / Windowsでは絶対パス、他のプラットフォームでは元の名前
 */
export function resolveCliPath(cliName: string): string {
  if (process.platform !== 'win32') return cliName;

  const cached = cliPathCache.get(cliName);
  if (cached !== undefined) return cached;

  let result = cliName;

  // NOTE: npm global bins on Windows are .cmd shims. `where claude` fails when the npm
  // bin directory is not yet in the bun process's PATH (inherited from the parent shell),
  // but `where claude.cmd` succeeds because cmd.exe always resolves shims. Try the bare
  // name first, then fall back to the .cmd shim before giving up.
  const tryWhere = (name: string): string | null => {
    try {
      const resolved = execSync(`where ${name}`, {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      })
        .trim()
        .split(/\r?\n/)[0];
      return resolved && existsSync(resolved) ? resolved : null;
    } catch {
      return null;
    }
  };

  const resolved =
    tryWhere(cliName) ?? (!cliName.endsWith('.cmd') ? tryWhere(`${cliName}.cmd`) : null);
  if (resolved) {
    logger.info(`[resolveCliPath] Resolved ${cliName} -> ${resolved}`);
    result = resolved;
  } else {
    // NOTE: Both `where {name}` and `where {name}.cmd` failed. spawn({ shell: true })
    // still works because cmd.exe re-resolves the PATH at execution time.
    logger.warn(`[resolveCliPath] Failed to resolve ${cliName}, using relative path`);
  }
  cliPathCache.set(cliName, result);
  return result;
}

/**
 * Resolves the effective Claude Code CLI path from environment or defaults.
 *
 * @returns Resolved absolute or relative CLI path / 解決されたCLIパス
 */
export function getClaudePath(): string {
  const isWindows = process.platform === 'win32';
  const baseClaudePath = process.env.CLAUDE_CODE_PATH || (isWindows ? 'claude.cmd' : 'claude');
  return resolveCliPath(baseClaudePath);
}

/**
 * Checks whether the Claude Code CLI binary is accessible on the current system.
 *
 * @returns true if the CLI responds to --version within 10 seconds / CLIが10秒以内に--versionに応答すればtrue
 */
export function checkClaudeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const claudePath = getClaudePath();
    const proc = spawn(claudePath, ['--version'], { shell: true });

    // NOTE: 10-second timeout prevents indefinite hang when CLI is missing.
    const timeout = setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 10000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
    proc.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

/**
 * Builds the final spawn command and args array for Claude Code CLI on the current platform.
 * On Windows, prepends `chcp 65001` for UTF-8 encoding and embeds all args in the command string.
 *
 * @param claudePath - Resolved CLI path / 解決されたCLIパス
 * @param args - CLI arguments to pass / CLIに渡す引数
 * @returns Tuple of [finalCommand, finalArgs] ready for spawn() / spawn()に渡す[最終コマンド, 最終引数]のタプル
 */
export function buildSpawnCommand(claudePath: string, args: string[]): [string, string[]] {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    // NOTE: On Windows, set UTF-8 code page with chcp 65001 before running claude.cmd.
    // All args are embedded in the command string so the shell interprets them correctly.
    const argsString = args
      .map((arg) => {
        if (arg.includes(' ') || arg.includes('&') || arg.includes('|')) {
          return `"${arg}"`;
        }
        return arg;
      })
      .join(' ');
    const quotedPath = claudePath.includes(' ') ? `"${claudePath}"` : claudePath;
    return [`chcp 65001 >NUL 2>&1 && ${quotedPath} ${argsString}`, []];
  }

  return [claudePath, args];
}
