import { Elysia } from 'elysia';
import { LRUCache } from 'lru-cache';
import { createLogger } from '../config/logger';

const log = createLogger('performance');

const cache = new LRUCache<string, { data: unknown; etag: string }>({
  max: 500,
  ttl: 1000 * 60 * 5,
  updateAgeOnGet: true,
  updateAgeOnHas: true,
});

function generateETag(data: unknown): string {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // NOTE: Convert to 32-bit integer to prevent overflow
  }
  return `"${Math.abs(hash).toString(36)}"`;
}

export const compressionMiddleware = new Elysia({ name: 'compression' }).derive(
  async ({ request }) => {
    const acceptEncoding = request.headers.get('accept-encoding');
    const supportsGzip = acceptEncoding?.includes('gzip');
    const supportsBrotli = acceptEncoding?.includes('br');

    return {
      compress: {
        gzip: supportsGzip,
        brotli: supportsBrotli,
        preferred: supportsBrotli ? 'brotli' : supportsGzip ? 'gzip' : null,
      },
    };
  },
);

export const cacheMiddleware = new Elysia({ name: 'cache' }).derive(
  async ({ request, set, path }) => {
    if (request.method !== 'GET') {
      return { cache: { enabled: false } };
    }

    const cacheKey = `${path}:${request.url}`;
    const cached = cache.get(cacheKey);

    const ifNoneMatch = request.headers.get('if-none-match');
    if (cached && ifNoneMatch === cached.etag) {
      set.status = 304;
      return {
        cache: {
          enabled: true,
          hit: true,
          status: 'not-modified',
          data: null,
        },
      };
    }

    return {
      cache: {
        enabled: true,
        hit: !!cached,
        key: cacheKey,
        data: cached?.data,
        etag: cached?.etag,
        set: (data: unknown) => {
          const etag = generateETag(data);
          cache.set(cacheKey, { data, etag });
          set.headers['etag'] = etag;
          set.headers['cache-control'] = 'private, max-age=300';
          return data;
        },
        invalidate: (pattern?: string) => {
          if (pattern) {
            for (const key of cache.keys()) {
              if (key.includes(pattern)) {
                cache.delete(key);
              }
            }
          } else {
            cache.delete(cacheKey);
          }
        },
      },
    };
  },
);

interface RequestMetrics {
  startTime: number;
  dbQueryTime: number;
  dbQueryCount: number;
}

const metricsMap = new WeakMap<Request, RequestMetrics>();

export const performanceMonitoring = new Elysia({ name: 'performance-monitoring' })
  .derive(({ request }) => {
    const metrics: RequestMetrics = {
      startTime: performance.now(),
      dbQueryTime: 0,
      dbQueryCount: 0,
    };

    metricsMap.set(request, metrics);

    return {
      metrics: {
        trackDbQuery: (duration: number) => {
          metrics.dbQueryTime += duration;
          metrics.dbQueryCount++;
        },
        getMetrics: () => metrics,
      },
    };
  })
  .onAfterHandle(({ request, set, path }) => {
    const metrics = metricsMap.get(request);
    if (metrics) {
      const totalTime = performance.now() - metrics.startTime;

      set.headers['x-response-time'] = `${totalTime.toFixed(2)}ms`;
      set.headers['x-db-queries'] = metrics.dbQueryCount.toString();
      set.headers['x-db-time'] = `${metrics.dbQueryTime.toFixed(2)}ms`;

      if (totalTime > 1000) {
        log.warn(
          {
            path,
            totalTimeMs: totalTime,
            dbTimeMs: metrics.dbQueryTime,
            dbQueryCount: metrics.dbQueryCount,
          },
          `Slow request detected: ${path} took ${totalTime.toFixed(2)}ms (DB: ${metrics.dbQueryTime.toFixed(2)}ms in ${metrics.dbQueryCount} queries)`,
        );
      }

      metricsMap.delete(request);
    }
  });

export const connectionPooling = {
  keepAliveTimeout: 30000,
  maxConnections: 1000,
  requestTimeout: 30000,
};

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export const rateLimitMiddleware = new Elysia({ name: 'rate-limit' }).derive(({ request, set }) => {
  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const now = Date.now();
  const windowMs = 60000;
  const maxRequests = 100;

  let clientData = rateLimitMap.get(clientIp);

  if (!clientData || clientData.resetAt < now) {
    clientData = { count: 1, resetAt: now + windowMs };
    rateLimitMap.set(clientIp, clientData);
  } else {
    clientData.count++;
  }

  set.headers['x-ratelimit-limit'] = maxRequests.toString();
  set.headers['x-ratelimit-remaining'] = Math.max(0, maxRequests - clientData.count).toString();
  set.headers['x-ratelimit-reset'] = new Date(clientData.resetAt).toISOString();

  if (clientData.count > maxRequests) {
    set.status = 429;
    set.headers['retry-after'] = Math.ceil((clientData.resetAt - now) / 1000).toString();
    return {
      rateLimit: {
        exceeded: true,
        message: 'Too many requests, please try again later',
      },
    };
  }

  return { rateLimit: { exceeded: false } };
});

// NOTE: Periodic cleanup prevents unbounded memory growth in rateLimitMap
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitMap.entries()) {
    if (data.resetAt < now) {
      rateLimitMap.delete(ip);
    }
  }
}, 60000);

export const performanceOptimization = new Elysia({ name: 'performance' })
  .use(compressionMiddleware)
  .use(cacheMiddleware)
  .use(performanceMonitoring)
  .use(rateLimitMiddleware);
