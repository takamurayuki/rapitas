/**
 * Rate Limiter Middleware
 * Configurable in-memory rate limiting for API endpoints
 */
import { Elysia } from 'elysia';
import { createLogger } from '../config/logger';

const log = createLogger('rate-limiter');

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

function getStore(name: string): Map<string, RateLimitEntry> {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

function checkLimit(
  store: Map<string, RateLimitEntry>,
  key: string,
  config: RateLimitConfig,
): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    return true;
  }

  if (entry.count >= config.maxRequests) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * Create a rate limiter guard function for use in route handlers.
 * Returns a function that checks rate limits and sets appropriate headers/status.
 */
export function createRateLimiter(
  name: string,
  config: RateLimitConfig = { maxRequests: 30, windowMs: 60_000 },
) {
  const store = getStore(name);

  return function rateLimit(
    set: { status?: number | string; headers: Record<string, string> },
    ip: string | undefined,
  ): boolean {
    const key = ip || 'unknown';
    if (!checkLimit(store, key, config)) {
      log.warn({ key, limiter: name }, 'Rate limit exceeded');
      set.status = 429;
      set.headers['Retry-After'] = String(Math.ceil(config.windowMs / 1000));
      return false;
    }
    return true;
  };
}

// Pre-configured limiters for common use cases
export const aiRateLimiter = createRateLimiter('ai', {
  maxRequests: 20,
  windowMs: 60_000,
});

export const agentRateLimiter = createRateLimiter('agent', {
  maxRequests: 10,
  windowMs: 60_000,
});

export const screenshotRateLimiter = createRateLimiter('screenshot', {
  maxRequests: 15,
  windowMs: 60_000,
});

// Periodic cleanup of expired entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [, store] of stores) {
    for (const [key, entry] of store) {
      if (now > entry.resetAt) {
        store.delete(key);
      }
    }
  }
}, 5 * 60_000);
