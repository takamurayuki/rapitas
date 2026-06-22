/**
 * GitOperations — Cached Git Command Executor
 *
 * TTL-based memoization for read-only git commands (git rev-parse, etc.).
 * Write operations (commit, branch create) must NOT use this layer.
 * Call clearGitCache(cwd) after any worktree removal to prevent stale entries.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../../../config/logger';
import { GIT_CACHE_ENABLED, getGitExecCacheTtlMs } from '../../../../config/cache-ttl';

const execAsync = promisify(exec);
const logger = createLogger('git-operations/git-exec');

interface CacheEntry {
  value: { stdout: string; stderr: string };
  expiresAt: number;
}

/** Cache hit/miss/expiry statistics for the git exec cache. */
export interface GitCacheStats {
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

const cache = new Map<string, CacheEntry>();

// NOTE: module-scope counters; process-global for the lifetime of the server.
// Reset via resetGitExecCacheStats() to open a new measurement window.
let hits = 0;
let misses = 0;
let expiries = 0;

function buildKey(command: string, cwd: string): string {
  // NOTE: space separates cwd and command to avoid boundary collisions
  // where a cwd suffix could merge with a command prefix.
  return `${cwd} ${command}`;
}

/**
 * Execute a read-only git command with TTL-based memoization.
 * Identical to `promisify(exec)(command, options)` — drop-in replacement.
 *
 * @param command - Full git command string (e.g. 'git rev-parse --absolute-git-dir') / gitコマンド文字列
 * @param options - Execution options; `cwd` is required for correct cache keying / 実行オプション（cwd必須）
 * @returns Same `{ stdout, stderr }` as execAsync / execAsyncと同じ戻り値
 * @throws {Error} On non-zero exit; failures are never cached / 非ゼロ終了時にthrow（失敗はキャッシュしない）
 */
export async function execGitReadonly(
  command: string,
  options: { cwd: string; encoding?: BufferEncoding },
): Promise<{ stdout: string; stderr: string }> {
  if (!GIT_CACHE_ENABLED) {
    logger.debug({ command, cwd: options.cwd }, '[git-exec] cache bypassed');
    return execAsync(command, options) as Promise<{ stdout: string; stderr: string }>;
  }

  const key = buildKey(command, options.cwd);
  const now = Date.now();
  const entry = cache.get(key);

  if (entry) {
    if (entry.expiresAt > now) {
      hits++;
      logger.debug({ command, cwd: options.cwd }, '[git-exec] cache hit');
      return entry.value;
    }
    // NOTE: Entry exists but TTL has elapsed — counted separately from cold misses
    // so callers can distinguish "cache never warmed" from "TTL too short".
    expiries++;
  } else {
    misses++;
  }

  // NOTE: Cache miss (or expired) — run exec. Failure is NOT cached so transient
  // errors (e.g. process startup race) never become permanent.
  const result = await (execAsync(command, options) as Promise<{ stdout: string; stderr: string }>);
  cache.set(key, { value: result, expiresAt: now + getGitExecCacheTtlMs() });
  logger.debug({ command, cwd: options.cwd }, '[git-exec] cache miss, stored');
  return result;
}

/**
 * Return a snapshot of cache hit/miss/expiry counters.
 *
 * @returns Current stats including hitRate and expiryRate (both 0 when total === 0) / 統計スナップショット
 */
export function getGitExecCacheStats(): GitCacheStats {
  const total = hits + misses + expiries;
  return {
    hits,
    misses,
    expiries,
    total,
    hitRate: total === 0 ? 0 : hits / total,
    expiryRate: total === 0 ? 0 : expiries / total,
    size: cache.size,
  };
}

/**
 * Reset hit/miss/expiry counters to zero without clearing the cache Map.
 * Use to open a new measurement window while keeping the cache warm.
 */
export function resetGitExecCacheStats(): void {
  hits = 0;
  misses = 0;
  expiries = 0;
}

/**
 * Invalidate all cached entries for a specific working directory.
 * Call after removing a worktree to prevent stale git-dir values.
 *
 * @param cwd - The working directory whose cache entries to clear / クリア対象のワーキングディレクトリ
 */
export function clearGitCache(cwd: string): void {
  const prefix = `${cwd} `;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
  logger.debug({ cwd }, '[git-exec] cache cleared for cwd');
}

/**
 * Invalidate all cached entries across all working directories and reset counters.
 * Primarily for use in test beforeEach to prevent cross-test contamination.
 */
export function clearAllGitCache(): void {
  cache.clear();
  hits = 0;
  misses = 0;
  expiries = 0;
  logger.debug('[git-exec] all cache cleared');
}
