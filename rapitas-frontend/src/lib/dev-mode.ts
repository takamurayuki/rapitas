/**
 * dev-mode
 *
 * Tiny helper that lets non-critical client caches (localStorage entries,
 * memoised fetches) opt out of caching while running on a developer's
 * machine. The intent is that code changes are immediately visible after a
 * reload — no more "Application > Storage > Clear site data" rituals.
 *
 * Two signals are checked:
 *   1. `process.env.NODE_ENV === 'development'` — set by Next.js when the
 *      dev server is running. Reliable on both server and client renders.
 *   2. `location.hostname` is localhost / 127.0.0.1 / *.local — caught for
 *      builds served via a dev URL even if NODE_ENV happens to be missing.
 *
 * Either match is enough. Callers can wrap reads/writes in `if (isDevHost())`
 * to skip caching entirely on dev hosts.
 */
export function isDevHost(): boolean {
  // NODE_ENV is replaced at build time by Next.js — safe on the server too.
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
    return true;
  }
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return (
    host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host.endsWith('.local')
  );
}
