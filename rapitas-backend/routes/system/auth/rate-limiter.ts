/**
 * Auth Rate Limiter
 *
 * Simple in-memory rate limiter for authentication endpoints.
 * Tracks attempt counts per identifier with a sliding time window.
 * Does not persist across process restarts — not suitable as a distributed rate limiter.
 */

const authAttempts = new Map<string, { count: number; resetAt: number }>();

/** Maximum login/registration attempts within the rate window. */
export const AUTH_RATE_LIMIT = 5;

/** Rate limit window duration in milliseconds (1 minute). */
export const AUTH_RATE_WINDOW = 60 * 1000;

/**
 * Check whether a given identifier is within the allowed rate limit.
 * Increments the counter on each allowed call.
 *
 * @param identifier - Unique key for the caller (e.g. "login:<ip>") / 呼び出し元の識別子
 * @returns true if the request is allowed / リクエストが許可される場合はtrue
 */
export function checkAuthRateLimit(identifier: string): boolean {
  const now = Date.now();
  const entry = authAttempts.get(identifier);

  if (!entry || now > entry.resetAt) {
    authAttempts.set(identifier, { count: 1, resetAt: now + AUTH_RATE_WINDOW });
    return true;
  }

  if (entry.count >= AUTH_RATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

// Purge expired entries every 5 minutes to prevent unbounded memory growth.
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of authAttempts) {
      if (now > entry.resetAt) authAttempts.delete(key);
    }
  },
  5 * 60 * 1000,
);
