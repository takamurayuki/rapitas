/**
 * Git CLI Execution Utilities
 *
 * Thin wrapper around the git binary using execFile (no shell, no escaping needed).
 * Counterpart to gh-client.ts for the gh CLI; this file covers git commands only.
 * Also provides git-specific error classification and retry infrastructure,
 * symmetric to gh-retry.ts for the GitHub CLI.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../config/logger';
import { sleep } from '../agents/abstraction/agent-retry';
import { computeBackoffDelay } from './gh-retry';

const log = createLogger('github-service:git-exec');
const execFileAsync = promisify(execFile);

// NOTE: execFile resolves via PATH, so an absolute path is not required (unlike
// gh.exe on Windows). Override via RAPITAS_GIT_BIN for CI or custom git installations.
const GIT_BIN = process.env.RAPITAS_GIT_BIN ?? 'git';

// ─── Error Classification ────────────────────────────────────────────────────

/**
 * Broad categories used to decide whether and how to retry a git CLI failure.
 * `unrecoverable` is the conservative default for unrecognized errors.
 * Note: git has no practical rate limit, so `rate_limit` and `head_behind`
 * (gh-specific) are intentionally absent.
 */
export type GitErrorCategory = 'transient' | 'auth' | 'not_found' | 'unrecoverable';

interface GitClassificationRule {
  pattern: RegExp;
  category: GitErrorCategory;
}

/**
 * Ordered rules — first match wins.
 * Auth is checked before transient to prevent "unable to access: 403" from
 * being misclassified as transient (network error).
 */
const GIT_CLASSIFICATION_RULES: GitClassificationRule[] = [
  {
    // NOTE: auth before transient — `unable to access` overlaps; 403/auth must win.
    pattern:
      /Authentication failed|could not read Username|Permission denied \(publickey\)|terminal prompts disabled|invalid credentials|\b403\b/i,
    category: 'auth',
  },
  {
    pattern:
      /not a git repository|pathspec .* did not match|unknown revision|couldn't find remote ref|repository not found|\b404\b/i,
    category: 'not_found',
  },
  {
    pattern:
      /Could not resolve host|Connection (timed out|refused)|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|early EOF|RPC failed|the remote end hung up|unable to access|\b50[23]\b/i,
    category: 'transient',
  },
];

/**
 * Classify a git CLI error message into a retry-relevant category.
 * Unrecognized messages return `unrecoverable` (conservative: no blind retries).
 *
 * @param message - Raw error message from git / gitエラーメッセージ
 * @returns Error category / エラーカテゴリ
 */
export function classifyGitError(message: string): GitErrorCategory {
  for (const rule of GIT_CLASSIFICATION_RULES) {
    if (rule.pattern.test(message)) return rule.category;
  }
  return 'unrecoverable';
}

// ─── Retry Policy ────────────────────────────────────────────────────────────

/** Configuration for a git retry attempt loop. Mirrors GhRetryOptions structure. */
export interface GitRetryPolicy {
  /** Error categories that permit a retry attempt. */
  retryOn: GitErrorCategory[];
  /** Maximum number of retry attempts after the first failure. */
  maxRetries: number;
  /** Base delay in milliseconds; actual delay is exponentially scaled. */
  baseDelay: number;
  /** Hard cap on computed delay in milliseconds to prevent excessive waits. */
  maxDelay: number;
}

/**
 * Policy for idempotent read operations (status / diff / log / rev-parse / remote get-url).
 * Retries transient network failures — no side-effect risk.
 */
export const GIT_READ_RETRY_POLICY: GitRetryPolicy = {
  retryOn: ['transient'],
  maxRetries: 2,
  baseDelay: 500,
  maxDelay: 8000,
};

/**
 * Policy for non-idempotent write operations (push / commit / tag-push).
 * No automatic retry by default to prevent duplicate side effects.
 * Idempotency-confirmed callers may opt in by passing a custom policy.
 */
export const GIT_WRITE_RETRY_POLICY: GitRetryPolicy = {
  retryOn: [],
  maxRetries: 0,
  baseDelay: 1000,
  maxDelay: 8000,
};

// ─── Core Execution ──────────────────────────────────────────────────────────

/**
 * Execute a git command and return trimmed stdout.
 *
 * @param args - Git subcommand and arguments / gitサブコマンドと引数
 * @param cwd - Optional working directory / 作業ディレクトリ
 * @param opts - Options: skipLog suppresses the error log; timeoutMs enforces a hard timeout / オプション
 * @returns Trimmed stdout string / 標準出力文字列
 * @throws {Error} When git exits with non-zero status or times out / 非ゼロ終了またはタイムアウト時
 */
export async function runGitCommand(
  args: string[],
  cwd?: string,
  opts?: { skipLog?: boolean; timeoutMs?: number },
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(GIT_BIN, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      timeout: opts?.timeoutMs,
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
 * Execute a git command with exponential-backoff retries according to the given policy.
 * Immediately re-throws for non-retryable categories (auth, not_found, unrecoverable).
 * On maxRetries exhaustion the last error is re-thrown unchanged.
 *
 * @param args - Git subcommand and arguments / gitサブコマンドと引数
 * @param cwd - Optional working directory / 作業ディレクトリ
 * @param opts - Options: skipLog, timeoutMs, and retry policy override / オプション
 * @returns Trimmed stdout string / 標準出力文字列
 * @throws {Error} Last error on retry exhaustion or non-retryable category / リトライ上限または非リトライカテゴリ時
 */
export async function runGitCommandWithRetry(
  args: string[],
  cwd?: string,
  opts?: { skipLog?: boolean; timeoutMs?: number; policy?: GitRetryPolicy },
): Promise<string> {
  const policy = opts?.policy ?? GIT_READ_RETRY_POLICY;
  const cmdOpts = { skipLog: opts?.skipLog, timeoutMs: opts?.timeoutMs };

  let lastError: Error = new Error('Unknown git error');

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      return await runGitCommand(args, cwd, cmdOpts);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const category = classifyGitError(lastError.message);
      const shouldRetry = policy.retryOn.includes(category) && attempt < policy.maxRetries;

      if (!shouldRetry) throw lastError;

      const delay = computeBackoffDelay(attempt, policy.baseDelay, policy.maxDelay);
      await sleep(delay);
    }
  }

  // NOTE: Unreachable — the loop always returns or throws via the `if (!shouldRetry)` guard above.
  throw lastError;
}

/**
 * Extract `{ owner, repo }` (lowercased) from a GitHub remote URL.
 * Accepts https and ssh forms. Returns null for non-github or unparseable URLs.
 *
 * @param url - GitHub https or ssh URL / GitHubのhttpsまたはssh形式URL
 * @returns Lowercased `{ owner, repo }`, or null when not parseable / 小文字のowner/repo、解析不能ならnull
 */
export function parseOwnerRepo(
  url: string | null | undefined,
): { owner: string; repo: string } | null {
  if (!url) return null;
  // Matches https://github.com/owner/repo(.git) and git@github.com:owner/repo(.git).
  // Limits to github.com and excludes query/fragment chars for stricter matching.
  const m = url.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return { owner: m[1].toLowerCase(), repo: m[2].toLowerCase() };
}

/**
 * Read a working directory's `origin` remote URL and parse its GitHub owner/repo.
 *
 * @param workingDirectory - Local git repository path / ローカルgitリポジトリパス
 * @returns Lowercased `{ owner, repo }`, or null when no remote or parse fails / owner/repo、失敗時はnull
 */
export async function ownerRepoFromGitRemote(
  workingDirectory: string,
): Promise<{ owner: string; repo: string } | null> {
  try {
    const url = await runGitCommand(['remote', 'get-url', 'origin'], workingDirectory, {
      skipLog: true,
    });
    return parseOwnerRepo(url);
  } catch {
    return null;
  }
}
