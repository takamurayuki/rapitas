/**
 * Git CLI Execution Utilities
 *
 * Thin wrapper around the git binary using execFile (no shell, no escaping needed).
 * Counterpart to gh-client.ts for the gh CLI; this file covers git commands only.
 * parseOwnerRepo and OwnerRepo types live in owner-repo.ts; re-exported here for
 * backward-compatible imports.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../config/logger';
import { parseOwnerRepo, type OwnerRepo } from './owner-repo';
export { parseOwnerRepo } from './owner-repo';
export type { OwnerRepo, OwnerRepoString } from './owner-repo';

const log = createLogger('github-service:git-exec');
const execFileAsync = promisify(execFile);

// NOTE: execFile resolves via PATH, so an absolute path is not required (unlike
// gh.exe on Windows). Override via RAPITAS_GIT_BIN for CI or custom git installations.
const GIT_BIN = process.env.RAPITAS_GIT_BIN ?? 'git';

/**
 * Execute a git command and return trimmed stdout.
 *
 * @param args - Git subcommand and arguments / gitサブコマンドと引数
 * @param cwd - Optional working directory / 作業ディレクトリ
 * @param opts - Options: skipLog suppresses the error log / オプション
 * @returns Trimmed stdout string / 標準出力文字列
 * @throws {Error} When git exits with non-zero status / 非ゼロ終了時
 */
export async function runGitCommand(
  args: string[],
  cwd?: string,
  opts?: { skipLog?: boolean },
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(GIT_BIN, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? (error as { stderr: string }).stderr
        : undefined;
    if (!opts?.skipLog) {
      log.error({ message, stderr }, `git command failed: git ${args.join(' ')}`);
    }
    throw new Error(stderr || message);
  }
}

/**
 * Read a working directory's `origin` remote URL and parse its GitHub owner/repo.
 *
 * @param workingDirectory - Local git repository path / ローカルgitリポジトリパス
 * @returns Lowercased {@link OwnerRepo}, or null when no remote or parse fails / OwnerRepo、失敗時はnull
 */
export async function ownerRepoFromGitRemote(
  workingDirectory: string,
): Promise<OwnerRepo | null> {
  try {
    const url = await runGitCommand(['remote', 'get-url', 'origin'], workingDirectory, {
      skipLog: true,
    });
    return parseOwnerRepo(url);
  } catch {
    return null;
  }
}
