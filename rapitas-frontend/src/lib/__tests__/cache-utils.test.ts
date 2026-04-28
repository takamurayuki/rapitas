import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cacheManager,
  enableCompressionHeaders,
  enableConnectionPooling,
  requestPartialFields,
  addCacheVersion,
} from '../cache-utils';

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('enableCompressionHeaders', () => {
  it('adds Accept-Encoding header', () => {
    const headers = enableCompressionHeaders();
    expect(headers).toEqual(expect.objectContaining({ 'Accept-Encoding': 'gzip, deflate, br' }));
  });

  it('preserves existing headers', () => {
    const headers = enableCompressionHeaders({
      'Content-Type': 'application/json',
    });
    expect(headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
      }),
    );
  });
});

describe('enableConnectionPooling', () => {
  it('adds Connection header', () => {
    const headers = enableConnectionPooling();
    expect(headers).toEqual(expect.objectContaining({ Connection: 'keep-alive' }));
  });
});

describe('requestPartialFields', () => {
  it('builds fields query string', () => {
    expect(requestPartialFields(['id', 'name', 'status'])).toBe('?fields=id,name,status');
  });

  it('handles single field', () => {
    expect(requestPartialFields(['id'])).toBe('?fields=id');
  });
});

describe('addCacheVersion', () => {
  it('adds version param to URL without query', () => {
    expect(addCacheVersion('https://api.com/data')).toBe('https://api.com/data?v=1.0');
  });

  it('adds version param to URL with existing query', () => {
    expect(addCacheVersion('https://api.com/data?page=1')).toBe(
      'https://api.com/data?page=1&v=1.0',
    );
  });

  it('uses custom version', () => {
    expect(addCacheVersion('https://api.com/data', '2.5')).toBe('https://api.com/data?v=2.5');
  });
});

describe('CacheManager', () => {
  beforeEach(() => {
    cacheManager.clearCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchWithETag', () => {
    it('fetches data and caches with ETag', async () => {
      const mockResponse = new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        headers: { ETag: '"abc123"' },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const result = await cacheManager.fetchWithETag('https://api.com/data');
      expect(result.data).toEqual({ id: 1 });
      expect(result.fromCache).toBe(false);
    });

    it('returns cached data on 304 response', async () => {
      // First call - populate cache
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { ETag: '"abc123"' },
        }),
      );
      await cacheManager.fetchWithETag('https://api.com/data');

      // Second call - 304 (include If-None-Match header check)
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 304 }));
      const result = await cacheManager.fetchWithETag('https://api.com/data');
      expect(result.data).toEqual({ id: 1 });
      expect(result.fromCache).toBe(true);
      // Verify If-None-Match header was sent
      const lastCall = fetchSpy.mock.calls[1];
      expect((lastCall[1] as RequestInit).headers).toEqual(
        expect.objectContaining({ 'If-None-Match': '"abc123"' }),
      );
    });

    it('throws on HTTP error without cache', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('Error', { status: 500 }));

      await expect(cacheManager.fetchWithETag('https://api.com/data')).rejects.toThrow(/500/);
    });
  });

  describe('clearCache', () => {
    it('clears all cache', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ a: 1 }), {
          status: 200,
          headers: { ETag: '"abc1"' },
        }),
      );
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ b: 1 }), {
          status: 200,
          headers: { ETag: '"abc2"' },
        }),
      );
      await cacheManager.fetchWithETag('https://api.com/a');
      await cacheManager.fetchWithETag('https://api.com/b');

      const statsBefore = cacheManager.getCacheStats();
      expect(statsBefore.entries.length).toBe(2);

      cacheManager.clearCache();
      const statsAfter = cacheManager.getCacheStats();
      expect(statsAfter.entries.length).toBe(0);
      fetchSpy.mockRestore();
    });

    it('clears cache by pattern', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ t: 1 }), {
          status: 200,
          headers: { ETag: '"abc1"' },
        }),
      );
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ u: 1 }), {
          status: 200,
          headers: { ETag: '"abc2"' },
        }),
      );
      await cacheManager.fetchWithETag('https://api.com/tasks');
      await cacheManager.fetchWithETag('https://api.com/users');

      cacheManager.clearCache(/tasks/);
      const stats = cacheManager.getCacheStats();
      expect(stats.entries.length).toBe(1);
      expect(stats.entries[0].key).toContain('users');
      fetchSpy.mockRestore();
    });
  });

  describe('getCacheStats', () => {
    it('returns empty stats for empty cache', () => {
      const stats = cacheManager.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.entries).toEqual([]);
    });
  });
});
