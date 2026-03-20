import { Redis } from 'ioredis';
import { LRUCache } from 'lru-cache';
import { createLogger } from '../../config/logger';

const log = createLogger('cache-service');

// Cache strategy interface
interface CacheStrategy {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(pattern?: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

// In-memory cache strategy (for development)
class MemoryCacheStrategy implements CacheStrategy {
  private cache: LRUCache<string, NonNullable<unknown>>;

  constructor(options: { max?: number; ttl?: number } = {}) {
    this.cache = new LRUCache<string, NonNullable<unknown>>({
      max: options.max || 1000,
      ttl: options.ttl || 1000 * 60 * 5, // default 5 minutes
      updateAgeOnGet: true,
      updateAgeOnHas: true,
    });
  }

  async get<T>(key: string): Promise<T | null> {
    return (this.cache.get(key) as T) || null;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    this.cache.set(key, value as NonNullable<unknown>, { ttl });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async clear(pattern?: string): Promise<void> {
    if (pattern) {
      for (const key of this.cache.keys()) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  async has(key: string): Promise<boolean> {
    return this.cache.has(key);
  }
}

// Redis cache strategy (for production)
class RedisCacheStrategy implements CacheStrategy {
  private redis: Redis;

  constructor(redisUrl?: string) {
    this.redis = new Redis(redisUrl || process.env.REDIS_URL || 'redis://localhost:6379');

    this.redis.on('error', (err: Error) => {
      log.error({ err }, 'Redis connection error');
    });

    this.redis.on('connect', () => {
      log.info('Redis connected successfully');
    });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      log.error({ err: error }, `Cache get error for key ${key}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl: number = 300): Promise<void> {
    try {
      await this.redis.setex(key, ttl, JSON.stringify(value));
    } catch (error) {
      log.error({ err: error }, `Cache set error for key ${key}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      log.error({ err: error }, `Cache delete error for key ${key}`);
    }
  }

  async clear(pattern?: string): Promise<void> {
    try {
      if (pattern) {
        const keys = await this.redis.keys(`*${pattern}*`);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } else {
        await this.redis.flushdb();
      }
    } catch (error) {
      log.error({ err: error }, 'Cache clear error');
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (error) {
      log.error({ err: error }, `Cache has error for key ${key}`);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}

// Multi-level cache strategy
class MultiLevelCacheStrategy implements CacheStrategy {
  private l1Cache: MemoryCacheStrategy;
  private l2Cache: CacheStrategy;

  constructor(l2Cache: CacheStrategy) {
    this.l1Cache = new MemoryCacheStrategy({ max: 100, ttl: 60000 }); // 1-minute L1 cache
    this.l2Cache = l2Cache;
  }

  async get<T>(key: string): Promise<T | null> {
    const l1Value = await this.l1Cache.get<T>(key);
    if (l1Value !== null) {
      return l1Value;
    }

    const l2Value = await this.l2Cache.get<T>(key);
    if (l2Value !== null) {
      // Promote to L1 cache
      await this.l1Cache.set(key, l2Value, 60000);
      return l2Value;
    }

    return null;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    // Store in both levels
    await Promise.all([
      this.l1Cache.set(key, value, Math.min(ttl || 60000, 60000)),
      this.l2Cache.set(key, value, ttl),
    ]);
  }

  async delete(key: string): Promise<void> {
    await Promise.all([this.l1Cache.delete(key), this.l2Cache.delete(key)]);
  }

  async clear(pattern?: string): Promise<void> {
    await Promise.all([this.l1Cache.clear(pattern), this.l2Cache.clear(pattern)]);
  }

  async has(key: string): Promise<boolean> {
    const l1Has = await this.l1Cache.has(key);
    if (l1Has) return true;
    return await this.l2Cache.has(key);
  }
}

// Cache service
export class CacheService {
  private strategy: CacheStrategy;
  private keyPrefix: string;

  constructor(
    options: {
      strategy?: 'memory' | 'redis' | 'multi';
      redisUrl?: string;
      keyPrefix?: string;
    } = {},
  ) {
    this.keyPrefix = options.keyPrefix || 'rapitas:';

    // Select strategy based on environment
    const strategyType =
      options.strategy || (process.env.NODE_ENV === 'production' ? 'multi' : 'memory');

    switch (strategyType) {
      case 'redis':
        this.strategy = new RedisCacheStrategy(options.redisUrl);
        break;
      case 'multi':
        this.strategy = new MultiLevelCacheStrategy(new RedisCacheStrategy(options.redisUrl));
        break;
      case 'memory':
      default:
        this.strategy = new MemoryCacheStrategy();
        break;
    }
  }

  private prefixKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  // Basic cache operations
  async get<T>(key: string): Promise<T | null> {
    return this.strategy.get<T>(this.prefixKey(key));
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    return this.strategy.set(this.prefixKey(key), value, ttl);
  }

  async delete(key: string): Promise<void> {
    return this.strategy.delete(this.prefixKey(key));
  }

  async clear(pattern?: string): Promise<void> {
    return this.strategy.clear(pattern ? this.prefixKey(pattern) : this.keyPrefix);
  }

  async has(key: string): Promise<boolean> {
    return this.strategy.has(this.prefixKey(key));
  }

  // Advanced cache operations
  async getOrSet<T>(key: string, factory: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, ttl);
    return value;
  }

  // Tag-based cache invalidation
  private taggedKeys = new Map<string, Set<string>>();

  async setWithTags<T>(key: string, value: T, tags: string[], ttl?: number): Promise<void> {
    await this.set(key, value, ttl);

    // Record tag-key associations
    tags.forEach((tag) => {
      if (!this.taggedKeys.has(tag)) {
        this.taggedKeys.set(tag, new Set());
      }
      this.taggedKeys.get(tag)!.add(key);
    });
  }

  async invalidateByTags(tags: string[]): Promise<void> {
    const keysToInvalidate = new Set<string>();

    tags.forEach((tag) => {
      const keys = this.taggedKeys.get(tag);
      if (keys) {
        keys.forEach((key) => keysToInvalidate.add(key));
        this.taggedKeys.delete(tag);
      }
    });

    await Promise.all(Array.from(keysToInvalidate).map((key) => this.delete(key)));
  }

  // Cache warmup
  async warmup(
    keys: Array<{ key: string; factory: () => Promise<unknown>; ttl?: number }>,
  ): Promise<void> {
    await Promise.all(keys.map(({ key, factory, ttl }) => this.getOrSet(key, factory, ttl)));
  }

  // Cache statistics
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
  };

  async getWithStats<T>(key: string): Promise<T | null> {
    const value = await this.get<T>(key);
    if (value !== null) {
      this.stats.hits++;
    } else {
      this.stats.misses++;
    }
    return value;
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
    return {
      ...this.stats,
      total,
      hitRate: `${hitRate.toFixed(2)}%`,
    };
  }

  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
    };
  }
}

// Singleton instance
export const cacheService = new CacheService();

// Cache key helpers
export const CacheKeys = {
  task: (id: string) => `task:${id}`,
  taskList: (filters: Record<string, unknown>) => `tasks:${JSON.stringify(filters)}`,
  project: (id: string) => `project:${id}`,
  user: (id: string) => `user:${id}`,
  statistics: (type: string) => `stats:${type}`,

  // TTL definitions
  TTL: {
    SHORT: 60, // 1 minute
    MEDIUM: 300, // 5 minutes
    LONG: 3600, // 1 hour
    DAY: 86400, // 1 day
  },
};

// Cache decorator (for TypeScript)
export function Cacheable(
  options: {
    ttl?: number;
    keyGenerator?: (...args: unknown[]) => string;
  } = {},
) {
  return function (target: object, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      const key = options.keyGenerator
        ? options.keyGenerator(...args)
        : `${target.constructor.name}:${propertyKey}:${JSON.stringify(args)}`;

      return cacheService.getOrSet(key, () => originalMethod.apply(this, args), options.ttl);
    };

    return descriptor;
  };
}
