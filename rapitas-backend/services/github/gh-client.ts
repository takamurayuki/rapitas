/**
 * GitHub CLI Client
 *
 * Thin wrapper around the gh CLI binary that executes shell commands
 * and returns raw stdout. Not responsible for JSON parsing or domain mapping.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../config/logger';

const log = createLogger('github-service:client');
const execFileAsync = promisify(execFile);

// gh binary path. execFile takes the executable + an args array and does NOT go
// through a shell, so arguments (issue titles/bodies with spaces, quotes, etc.)
// are passed literally and need no escaping. The Windows path must therefore be
// UNQUOTED here (quoting is a shell concept).
const GH_BIN = process.platform === 'win32' ? 'C:\\Program Files\\GitHub CLI\\gh.exe' : 'gh';

/**
 * Execute a gh CLI command and return trimmed stdout.
 *
 * @param args - Array of CLI arguments / CLIコマンド引数
 * @param cwd - Optional working directory / 作業ディレクトリ
 * @returns Trimmed stdout string / 標準出力文字列
 * @throws {Error} When gh command exits with non-zero status / コマンド失敗時
 */
export async function runGhCommand(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(GH_BIN, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
      windowsHide: true,
    });
    return stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? (error as { stderr: string }).stderr
        : undefined;
    log.error({ message }, `gh command failed: gh ${args.join(' ')}`);
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

/** A repository the authenticated gh user can access. */
export interface GhRepo {
  nameWithOwner: string;
  name: string;
  owner: string;
  url: string;
  description: string;
  visibility: string;
}

/**
 * List repositories the authenticated gh user can access (`gh repo list`), so
 * the user can add an integration by picking from a list instead of pasting URLs.
 *
 * @param limit - Max repos to return / 取得する最大件数
 * @returns Repositories (empty array on failure) / リポジトリ一覧（失敗時は空配列）
 */
export async function listRepositories(limit = 100): Promise<GhRepo[]> {
  try {
    const out = await runGhCommand([
      'repo',
      'list',
      '--limit',
      String(limit),
      '--json',
      'nameWithOwner,name,owner,url,description,visibility',
    ]);
    const raw = JSON.parse(out) as Array<{
      nameWithOwner: string;
      name: string;
      owner?: { login?: string };
      url: string;
      description?: string | null;
      visibility?: string;
    }>;
    return raw.map((r) => ({
      nameWithOwner: r.nameWithOwner,
      name: r.name,
      owner: r.owner?.login ?? r.nameWithOwner.split('/')[0] ?? '',
      url: r.url,
      description: r.description ?? '',
      visibility: r.visibility ?? '',
    }));
  } catch {
    return [];
  }
}
