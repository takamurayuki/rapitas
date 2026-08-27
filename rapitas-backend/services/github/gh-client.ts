/**
 * GitHub CLI Client
 *
 * Thin wrapper around the gh CLI binary that executes shell commands
 * and returns raw stdout. Not responsible for JSON parsing or domain mapping.
 */

import { execFile } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'util';
import { createLogger } from '../../config/logger';
import { withGhRetry, READ_RETRY_POLICY } from './gh-retry';
import type { GhRetryPolicy } from './gh-retry';

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
 * @param opts - Options: skipLog suppresses the error log so callers can handle expected failures / オプション
 * @returns Trimmed stdout string / 標準出力文字列
 * @throws {Error} When gh command exits with non-zero status / コマンド失敗時
 */
export async function runGhCommand(
  args: string[],
  cwd?: string,
  opts?: { skipLog?: boolean },
): Promise<string> {
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
    const failure = new Error(stderr || message);
    if (!opts?.skipLog) {
      log.error({ err: failure }, `gh command failed: gh ${args.join(' ')}`);
    }
    throw failure;
  }
}

/**
 * Execute a gh CLI command with exponential-backoff retries.
 * Defaults to READ_RETRY_POLICY; callers must explicitly pass WRITE_RETRY_POLICY
 * for non-idempotent operations (create / merge / comment) to avoid accidental
 * duplicate-resource creation.
 *
 * @param args - Array of CLI arguments / CLIコマンド引数
 * @param cwd - Optional working directory / 作業ディレクトリ
 * @param opts - Options: policy overrides retry behaviour; skipLog suppresses error log / オプション
 * @returns Trimmed stdout string / 標準出力文字列
 * @throws {Error} When gh command fails after all retry attempts / 全リトライ失敗時
 */
export async function runGhCommandWithRetry(
  args: string[],
  cwd?: string,
  opts?: { skipLog?: boolean; policy?: GhRetryPolicy },
): Promise<string> {
  const { policy = READ_RETRY_POLICY, ...baseOpts } = opts ?? {};
  return withGhRetry(() => runGhCommand(args, cwd, baseOpts), policy);
}

/**
 * Execute a gh CLI command whose body may contain multi-line text, Japanese
 * characters, or exceed the Windows CreateProcess argument-length limit.
 *
 * Writes `body` to a UTF-8 temp file in os.tmpdir(), appends
 * `--body-file <path>` to args, then calls runGhCommand. The temp file is
 * unconditionally removed in a finally block — unlink failures emit a warn
 * log only and do not affect the return value.
 *
 * When `body` is undefined, delegates directly to runGhCommand without
 * creating any file or appending --body-file.
 *
 * @param baseArgs - CLI arguments without any --body or --body-file / --bodyなしのCLI引数
 * @param body - Body text passed via temp file; undefined omits --body-file / 本文テキスト（undefinedの場合はファイル経由しない）
 * @param cwd - Optional working directory / 作業ディレクトリ
 * @param opts - Options forwarded to runGhCommand / runGhCommandに転送するオプション
 * @returns Trimmed stdout string / 標準出力文字列
 * @throws {Error} When gh command exits with non-zero status / コマンド失敗時
 */
export async function runGhCommandWithBody(
  baseArgs: string[],
  body: string | undefined,
  cwd?: string,
  opts?: { skipLog?: boolean },
): Promise<string> {
  if (body === undefined) {
    return runGhCommand(baseArgs, cwd, opts);
  }

  const tmpPath = join(tmpdir(), `gh-body-${randomUUID()}.md`);
  try {
    await writeFile(tmpPath, body, 'utf8');
    return await runGhCommand([...baseArgs, '--body-file', tmpPath], cwd, opts);
  } finally {
    try {
      await unlink(tmpPath);
    } catch (err) {
      // NOTE: Disk cleanup failure; OS will eventually clear os.tmpdir() so
      // we log a warning instead of propagating to avoid masking the gh result.
      log.warn({ tmpPath, err }, 'Failed to delete gh body temp file');
    }
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
