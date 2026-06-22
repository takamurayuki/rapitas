/**
 * Git Cache TTL Configuration
 *
 * Single source of truth for git cache TTL constants and env var overrides.
 * All git caching layers (local exec and remote URL) source their TTL from here.
 * Not responsible for cache storage or invalidation — those live in git-exec files.
 */

/**
 * Shared default TTL in milliseconds, used when the per-cache env vars are unset.
 * Matches the historical hard-coded value in both git-exec.ts files.
 */
const DEFAULT_GIT_CACHE_TTL_MS = 30_000;

/**
 * Whether git caching is globally enabled.
 * Set RAPITAS_GIT_EXEC_CACHE='0' to bypass all git caches (both local and remote).
 *
 * NOTE: Evaluated once at module load time to match the pre-existing behaviour of
 * both git-exec.ts files, which also evaluated RAPITAS_GIT_EXEC_CACHE at load time.
 */
export const GIT_CACHE_ENABLED = process.env['RAPITAS_GIT_EXEC_CACHE'] !== '0';

/**
 * Parse a raw env var string into a positive-integer TTL in milliseconds.
 * Falls back to DEFAULT_GIT_CACHE_TTL_MS when the value is unset, non-numeric, or ≤ 0.
 * Mirrors the existing getTtlMs() implementation in orchestrator/git-exec.ts.
 */
function parseTtlMs(raw: string | undefined): number {
  const parsed = parseInt(raw ?? '', 10);
  // NOTE: isNaN catches non-numeric strings; `<= 0` prevents 0 / negative TTLs
  // that would effectively disable caching silently rather than using the default.
  return isNaN(parsed) || parsed <= 0 ? DEFAULT_GIT_CACHE_TTL_MS : parsed;
}

/**
 * Return the TTL in milliseconds for the local git-exec cache (rev-parse, etc.).
 * Reads RAPITAS_GIT_EXEC_CACHE_TTL_MS on every call so hot-reload via env works
 * in the same process lifecycle as the existing getTtlMs() it replaces.
 *
 * @returns TTL in ms; falls back to 30 000 when env var is unset or invalid / 未設定・不正値時は30000ms
 */
export function getGitExecCacheTtlMs(): number {
  return parseTtlMs(process.env['RAPITAS_GIT_EXEC_CACHE_TTL_MS']);
}

/**
 * Return the TTL in milliseconds for the git remote URL cache (remote get-url origin).
 * Reads RAPITAS_GIT_REMOTE_CACHE_TTL_MS on every call, allowing per-environment tuning
 * of the remote lookup cache independently of the local exec cache.
 *
 * @returns TTL in ms; falls back to 30 000 when env var is unset or invalid / 未設定・不正値時は30000ms
 */
export function getGitRemoteCacheTtlMs(): number {
  return parseTtlMs(process.env['RAPITAS_GIT_REMOTE_CACHE_TTL_MS']);
}
