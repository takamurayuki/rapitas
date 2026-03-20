/**
 * GitHub CLI Client
 *
 * Thin wrapper around the gh CLI binary that executes shell commands
 * and returns raw stdout. Not responsible for JSON parsing or domain mapping.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../config/logger';

const log = createLogger('github-service:client');
const execAsync = promisify(exec);

/**
 * Execute a gh CLI command and return trimmed stdout.
 *
 * @param args - Array of CLI arguments / CLIコマンド引数
 * @param cwd - Optional working directory / 作業ディレクトリ
 * @returns Trimmed stdout string / 標準出力文字列
 * @throws {Error} When gh command exits with non-zero status / コマンド失敗時
 */
export async function runGhCommand(args: string[], cwd?: string): Promise<string> {
  // Full path to gh on Windows
  const ghPath = process.platform === 'win32' ? '"C:\\Program Files\\GitHub CLI\\gh.exe"' : 'gh';
  const command = `${ghPath} ${args.join(' ')}`;
  try {
    const { stdout } = await execAsync(command, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? (error as { stderr: string }).stderr
        : undefined;
    log.error({ message }, `gh command failed: ${command}`);
    throw new Error(stderr || message);
  }
}

/**
 * Check if the gh CLI binary is installed and reachable.
 *
 * @returns true if gh is available / ghが利用可能かどうか
 */
export async function isGhAvailable(): Promise<boolean> {
  try {
    await runGhCommand(['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if gh CLI is authenticated with a GitHub account.
 *
 * @returns true if authenticated / 認証済みかどうか
 */
export async function isAuthenticated(): Promise<boolean> {
  try {
    await runGhCommand(['auth', 'status']);
    return true;
  } catch {
    return false;
  }
}
