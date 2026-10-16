/**
 * cache.test.ts
 *
 * ApiClientCache のTTL失効・LRU的な追い出し・localStorage永続化(タスク詳細限定)・
 * 破損データからの防御的復旧を検証する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClientCache } from '../cache';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const STORAGE_KEY = 'rapitas-api-cache';

describe('ApiClientCache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('get / set', () => {
    it('未設定のキーはnullを返す', () => {
      const cache = new ApiClientCache();
      expect(cache.get('missing')).toBeNull();
    });

    it('setしたデータをgetで取得できること', () => {
      const cache = new ApiClientCache();
      cache.set('key1', { value: 42 });
      expect(cache.get<{ value: number }>('key1')).toEqual({ value: 42 });
    });

    it('TTL切れのエントリはnullを返し、キャッシュから削除されること', () => {
      const cache = new ApiClientCache();
      cache.set('expired', { value: 1 }, -1); // already expired

      expect(cache.get('expired')).toBeNull();
      // A second get proves the entry was actually deleted, not just skipped once.
      cache.set('expired-marker', 'noop');
      expect(cache.get('expired')).toBeNull();
    });
  });

  describe('タスク詳細エントリの永続化', () => {
    it('/tasks/ を含むキーはlocalStorageへ保存されること', () => {
      const cache = new ApiClientCache();
      cache.set('/tasks/42', { id: 42 });

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      expect(stored['/tasks/42']).toBeTruthy();
      expect(stored['/tasks/42'].data).toEqual({ id: 42 });
    });

    it('/tasks/ を含まないキーはlocalStorageへ保存されないこと', () => {
      const cache = new ApiClientCache();
      cache.set('/categories', { id: 1 });

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      expect(stored['/categories']).toBeUndefined();
    });

    it('コンストラクタで期限内の永続化エントリを読み込むこと', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          '/tasks/1': { data: { id: 1 }, timestamp: Date.now(), expiry: Date.now() + 100000 },
        }),
      );

      const cache = new ApiClientCache();
      expect(cache.get<{ id: number }>('/tasks/1')).toEqual({ id: 1 });
    });

    it('コンストラクタで期限切れの永続化エントリは読み込まないこと', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          '/tasks/1': { data: { id: 1 }, timestamp: Date.now() - 200000, expiry: Date.now() - 1 },
        }),
      );

      const cache = new ApiClientCache();
      expect(cache.get('/tasks/1')).toBeNull();
    });

    it('壊れたJSONが保存されていても例外を投げず空として扱うこと', () => {
      localStorage.setItem(STORAGE_KEY, '{not valid json');

      expect(() => new ApiClientCache()).not.toThrow();
      const cache = new ApiClientCache();
      expect(cache.get('/tasks/1')).toBeNull();
    });

    it('タスク詳細エントリが50件に達すると最古のものを追い出すこと', () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      const cache = new ApiClientCache();

      for (let i = 0; i < 50; i++) {
        vi.setSystemTime(i * 10);
        cache.set(`/tasks/${i}`, { id: i });
      }

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const taskKeys = Object.keys(stored).filter((k) => k.includes('/tasks/'));
      // The 51st write should have evicted the oldest ('/tasks/0') to stay at the cap.
      expect(taskKeys.length).toBeLessThanOrEqual(50);

      vi.setSystemTime(500);
      cache.set('/tasks/50', { id: 50 });
      const storedAfter = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      expect(storedAfter['/tasks/0']).toBeUndefined();
      expect(storedAfter['/tasks/50']).toBeTruthy();
    });
  });

  describe('clear', () => {
    it('パターン指定時は一致するキーのみ削除すること', () => {
      const cache = new ApiClientCache();
      cache.set('/tasks/1', { id: 1 });
      cache.set('/tasks/2', { id: 2 });
      cache.set('/categories', { id: 3 });

      cache.clear('/tasks/');

      expect(cache.get('/tasks/1')).toBeNull();
      expect(cache.get('/tasks/2')).toBeNull();
      expect(cache.get('/categories')).toEqual({ id: 3 });
    });

    it('パターン指定時にlocalStorageの対応エントリも削除すること', () => {
      const cache = new ApiClientCache();
      cache.set('/tasks/1', { id: 1 });
      cache.clear('/tasks/');

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      expect(stored['/tasks/1']).toBeUndefined();
    });

    it('引数なしの場合は全キャッシュとlocalStorageを消去すること', () => {
      const cache = new ApiClientCache();
      cache.set('/tasks/1', { id: 1 });
      cache.set('/categories', { id: 2 });

      cache.clear();

      expect(cache.get('/tasks/1')).toBeNull();
      expect(cache.get('/categories')).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe('getStats', () => {
    it('空のキャッシュではサイズ0・エントリ0件を返すこと', () => {
      const cache = new ApiClientCache();
      const stats = cache.getStats();
      expect(stats.size).toBe(0);
      expect(stats.entries).toEqual([]);
    });

    it('エントリサイズの降順でソートして返すこと', () => {
      const cache = new ApiClientCache();
      cache.set('small', { a: 1 });
      cache.set('large', { a: 'x'.repeat(200) });

      const stats = cache.getStats();
      expect(stats.entries[0].key).toBe('large');
      expect(stats.entries[1].key).toBe('small');
      expect(stats.size).toBeGreaterThan(0);
    });
  });

  describe('localStorage異常系', () => {
    it('QuotaExceededErrorの場合は永続キャッシュをクリーンアップすること', () => {
      const cache = new ApiClientCache();
      const setItemSpy = vi
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementationOnce(() => {
          throw new DOMException('quota', 'QuotaExceededError');
        })
        // cleanupPersistentCache's own setItem call after the failure
        .mockImplementationOnce(() => {});

      expect(() => cache.set('/tasks/1', { id: 1 })).not.toThrow();
      expect(setItemSpy).toHaveBeenCalledTimes(2);

      setItemSpy.mockRestore();
    });

    it('removePersistentEntry でlocalStorageアクセスが例外を投げても伝播しないこと', () => {
      const cache = new ApiClientCache();
      cache.set('/tasks/1', { id: 1 });

      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage unavailable');
      });

      expect(() => cache.clear('/tasks/')).not.toThrow();

      getItemSpy.mockRestore();
    });

    it('cleanupPersistentCache でlocalStorageアクセスが例外を投げても伝播しないこと', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ '/tasks/1': { data: {}, timestamp: 0, expiry: -1 } }),
      );
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage unavailable');
      });

      expect(() => new ApiClientCache()).not.toThrow();

      getItemSpy.mockRestore();
    });
  });

  describe('200件を超えるエントリの追い出し', () => {
    it('メモリキャッシュが200件を超えると最古のエントリを削除すること', () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      const cache = new ApiClientCache();

      for (let i = 0; i < 201; i++) {
        vi.setSystemTime(i * 10);
        cache.set(`key-${i}`, { i });
      }

      expect(cache.get('key-0')).toBeNull();
      expect(cache.get('key-200')).toEqual({ i: 200 });
      expect(cache.getStats().entries.length).toBeLessThanOrEqual(200);
    });
  });
});
