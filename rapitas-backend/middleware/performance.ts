import { Elysia } from "elysia";
import { LRUCache } from "lru-cache";

// メモリキャッシュの設定
const cache = new LRUCache<string, { data: unknown; etag: string }>({
  max: 500, // 最大500エントリ
  ttl: 1000 * 60 * 5, // 5分のTTL
  updateAgeOnGet: true,
  updateAgeOnHas: true,
});

// ETagを生成
function generateETag(data: unknown): string {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 32bitに変換
  }
  return `"${Math.abs(hash).toString(36)}"`;
}

// レスポンス圧縮の設定
export const compressionMiddleware = new Elysia({ name: "compression" })
  .derive(async ({ request }) => {
    const acceptEncoding = request.headers.get("accept-encoding");
    const supportsGzip = acceptEncoding?.includes("gzip");
    const supportsBrotli = acceptEncoding?.includes("br");

    return {
      compress: {
        gzip: supportsGzip,
        brotli: supportsBrotli,
        preferred: supportsBrotli ? "brotli" : supportsGzip ? "gzip" : null
      }
    };
  });

// キャッシュミドルウェア
export const cacheMiddleware = new Elysia({ name: "cache" })
  .derive(async ({ request, set, path }) => {
    // GETリクエストのみキャッシュ
    if (request.method !== "GET") {
      return { cache: { enabled: false } };
    }

    const cacheKey = `${path}:${request.url}`;
    const cached = cache.get(cacheKey);

    // If-None-Matchヘッダーのチェック
    const ifNoneMatch = request.headers.get("if-none-match");
    if (cached && ifNoneMatch === cached.etag) {
      set.status = 304;
      return {
        cache: {
          enabled: true,
          hit: true,
          status: "not-modified",
          data: null
        }
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
          set.headers["etag"] = etag;
          set.headers["cache-control"] = "private, max-age=300";
          return data;
        },
        invalidate: (pattern?: string) => {
          if (pattern) {
            // パターンマッチングでキャッシュを無効化
            for (const key of cache.keys()) {
              if (key.includes(pattern)) {
                cache.delete(key);
              }
            }
          } else {
            cache.delete(cacheKey);
          }
        }
      }
    };
  });

// パフォーマンスモニタリング
interface RequestMetrics {
  startTime: number;
  dbQueryTime: number;
  dbQueryCount: number;
}

const metricsMap = new WeakMap<Request, RequestMetrics>();

export const performanceMonitoring = new Elysia({ name: "performance-monitoring" })
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
      }
    };
  })
  .onAfterHandle(({ request, set, path }) => {
    const metrics = metricsMap.get(request);
    if (metrics) {
      const totalTime = performance.now() - metrics.startTime;

      // レスポンスヘッダーにパフォーマンス情報を追加
      set.headers["x-response-time"] = `${totalTime.toFixed(2)}ms`;
      set.headers["x-db-queries"] = metrics.dbQueryCount.toString();
      set.headers["x-db-time"] = `${metrics.dbQueryTime.toFixed(2)}ms`;

      // 遅いリクエストの警告
      if (totalTime > 1000) {
        console.warn(`Slow request detected: ${path} took ${totalTime.toFixed(2)}ms (DB: ${metrics.dbQueryTime.toFixed(2)}ms in ${metrics.dbQueryCount} queries)`);
      }

      metricsMap.delete(request);
    }
  });

// 接続プーリング最適化
export const connectionPooling = {
  // HTTP Keep-Aliveの設定
  keepAliveTimeout: 30000, // 30秒

  // 同時接続数の制限
  maxConnections: 1000,

  // リクエストタイムアウト
  requestTimeout: 30000, // 30秒
};

// レート制限（スライディングウィンドウ方式）
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export const rateLimitMiddleware = new Elysia({ name: "rate-limit" })
  .derive(({ request, set }) => {
    const clientIp = request.headers.get("x-forwarded-for") || "unknown";
    const now = Date.now();
    const windowMs = 60000; // 1分
    const maxRequests = 100; // 1分あたり100リクエスト

    let clientData = rateLimitMap.get(clientIp);

    if (!clientData || clientData.resetAt < now) {
      clientData = { count: 1, resetAt: now + windowMs };
      rateLimitMap.set(clientIp, clientData);
    } else {
      clientData.count++;
    }

    // ヘッダーの設定
    set.headers["x-ratelimit-limit"] = maxRequests.toString();
    set.headers["x-ratelimit-remaining"] = Math.max(0, maxRequests - clientData.count).toString();
    set.headers["x-ratelimit-reset"] = new Date(clientData.resetAt).toISOString();

    if (clientData.count > maxRequests) {
      set.status = 429;
      set.headers["retry-after"] = Math.ceil((clientData.resetAt - now) / 1000).toString();
      return {
        rateLimit: {
          exceeded: true,
          message: "Too many requests, please try again later"
        }
      };
    }

    return { rateLimit: { exceeded: false } };
  });

// 定期的なクリーンアップ
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitMap.entries()) {
    if (data.resetAt < now) {
      rateLimitMap.delete(ip);
    }
  }
}, 60000); // 1分ごと

// 全体的なパフォーマンス最適化ミドルウェア
export const performanceOptimization = new Elysia({ name: "performance" })
  .use(compressionMiddleware)
  .use(cacheMiddleware)
  .use(performanceMonitoring)
  .use(rateLimitMiddleware);