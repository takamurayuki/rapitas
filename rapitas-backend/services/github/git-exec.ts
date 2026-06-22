/**
 * Git CLI Execution Utilities
 *
 * Thin wrapper around the git binary using execFile (no shell, no escaping needed).
 * Counterpart to gh-client.ts for the gh CLI; this file covers git commands only.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../config/logger';

const log = createLogger('github-service:git-exec');
const execFileAsync = promisify(execFile);

const DEFAULT_REMOTE_CACHE_TTL_MS = 30_000;
const REMOTE_CACHE_ENABLED = process.env.RAPITAS_GIT_EXEC_CACHE !== '0';

interface RemoteCacheEntry {
  value: { owner: string; repo: string } | null;
  expiresAt: number;
}

/** Cache hit/miss/expiry statistics for the git remote URL cache. */
export interface GitRemoteCacheStats {
  /** Number of cache hits (valid, non-expired entry returned). */
  hits: number;
  /** Number of cold misses (no entry found). */
  misses: number;
  /** Number of TTL-expired lookups (entry existed but stale). */
  expiries: number;
  /** Total lookup count: hits + misses + expiries. */
  total: number;
  /** Fraction of lookups that were hits. 0 when total === 0. */
  hitRate: number;
  /** Fraction of lookups that were expiries. 0 when total === 0. */
  expiryRate: number;
  /** Current number of entries in the cache Map (live or stale). */
  size: number;
}

const remoteCache = new Map<string, RemoteCacheEntry>();

// NOTE: module-scope counters; process-global for the lifetime of the server.
// Counted only when REMOTE_CACHE_ENABLED=true (bypass path = no count).
// Reset via resetGitRemoteCacheStats() to open a new measurement window.
let hits = 0;
let misses = 0;
let expiries = 0;

/**
 * Invalidate the remote URL cache for a specific working directory.
 *
 * @param cwd - The working directory to clear / クリア対象のディレクトリ
 */
export function clearGitRemoteCache(cwd: string): void {
  remoteCache.delete(cwd);
}

/**
 * Invalidate all remote URL cache entries and reset counters.
 * Primarily for use in tests.
 */
export function clearAllGitRemoteCache(): void {
  remoteCache.clear();
  hits = 0;
  misses = 0;
  expiries = 0;
}

/**
 * Return a snapshot of remote cache hit/miss/expiry counters.
 *
 * @returns Current stats including hitRate and expiryRate (both 0 when total === 0) / 統計スナップショット
 */
export function getGitRemoteCacheStats(): GitRemoteCacheStats {
  const total = hits + misses + expiries;
  return {
    hits,
    misses,
    expiries,
    total,
    hitRate: total === 0 ? 0 : hits / total,
    expiryRate: total === 0 ? 0 : expiries / total,
    size: remoteCache.size,
  };
}

/**
 * Reset hit/miss/expiry counters to zero without clearing the cache Map.
 * Use to open a new measurement window while keeping the cache warm.
 */
export function resetGitRemoteCacheStats(): void {
  hits = 0;
  misses = 0;
  expiries = 0;
}

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
  if (REMOTE_CACHE_ENABLED) {
    const now = Date.now();
    const entry = remoteCache.get(workingDirectory);
    if (entry) {
      if (entry.expiresAt > now) {
        hits++;
        return entry.value;
      }
      // NOTE: Entry exists but TTL has elapsed — counted separately from cold misses
      // so callers can distinguish "cache never warmed" from "TTL too short".
      expiries++;
    } else {
      misses++;
    }
  }

  let result: { owner: string; repo: string } | null;
  try {
    const url = await runGitCommand(['remote', 'get-url', 'origin'], workingDirectory, {
      skipLog: true,
    });
    result = parseOwnerRepo(url);
  } catch {
    // NOTE: Errors are not cached — a transient git failure should not permanently
    // block subsequent lookups (e.g. remote not yet configured on first clone).
    return null;
  }

  if (REMOTE_CACHE_ENABLED) {
    remoteCache.set(workingDirectory, {
      value: result,
      expiresAt: Date.now() + DEFAULT_REMOTE_CACHE_TTL_MS,
    });
  }
  return result;
}
