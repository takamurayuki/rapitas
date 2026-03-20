/**
 * Cache Service テスト
 * メモリキャッシュ戦略を使用したCacheServiceのテスト
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { CacheService, CacheKeys } from '../../services/core/cache-service';

describe('CacheService (memory strategy)', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService({ strategy: 'memory', keyPrefix: 'test:' });
  });

  describe('get / set', () => {
    test('setした値をgetで取得できること', async () => {
      await cache.set('key1', { name: 'test' });
      const result = await cache.get<{ name: string }>('key1');
      expect(result).toEqual({ name: 'test' });
    });

    test('存在しないキーでnullを返すこと', async () => {
      const result = await cache.get('nonexistent');
      expect(result).toBeNull();
    });

    test('文字列値を正しく保存・取得できること', async () => {
      await cache.set('str', 'hello');
      expect(await cache.get<string>('str')).toBe('hello');
    });

    test('数値を正しく保存・取得できること', async () => {
      await cache.set('num', 42);
      expect(await cache.get<number>('num')).toBe(42);
    });

    test('配列を正しく保存・取得できること', async () => {
      await cache.set('arr', [1, 2, 3]);
      expect(await cache.get<number[]>('arr')).toEqual([1, 2, 3]);
    });

    test('値を上書きできること', async () => {
      await cache.set('key', 'first');
      await cache.set('key', 'second');
      expect(await cache.get<string>('key')).toBe('second');
    });
  });

  describe('delete', () => {
    test('キーを削除できること', async () => {
      await cache.set('key', 'value');
      await cache.delete('key');
      expect(await cache.get('key')).toBeNull();
    });

    test('存在しないキーの削除でエラーにならないこと', async () => {
      await cache.delete('nonexistent'); // should not throw
    });
  });

  describe('has', () => {
    test('存在するキーでtrueを返すこと', async () => {
      await cache.set('key', 'value');
      expect(await cache.has('key')).toBe(true);
    });

    test('存在しないキーでfalseを返すこと', async () => {
      expect(await cache.has('nonexistent')).toBe(false);
    });

    test('削除後にfalseを返すこと', async () => {
      await cache.set('key', 'value');
      await cache.delete('key');
      expect(await cache.has('key')).toBe(false);
    });
  });

  describe('clear', () => {
    test('全件クリアできること', async () => {
      await cache.set('a', 1);
      await cache.set('b', 2);
      await cache.clear();
      expect(await cache.get('a')).toBeNull();
      expect(await cache.get('b')).toBeNull();
    });

    test('パターン指定でマッチするキーのみクリアすること', async () => {
      await cache.set('user:1', 'alice');
      await cache.set('user:2', 'bob');
      await cache.set('task:1', 'task');
      await cache.clear('user');
      expect(await cache.get('user:1')).toBeNull();
      expect(await cache.get('user:2')).toBeNull();
      expect(await cache.get<string>('task:1')).toBe('task');
    });
  });

  describe('getOrSet', () => {
    test('キャッシュミス時にfactoryを呼び出し結果をキャッシュすること', async () => {
      let callCount = 0;
      const factory = async () => {
        callCount++;
        return 'computed';
      };

      const result1 = await cache.getOrSet('key', factory);
      expect(result1).toBe('computed');
      expect(callCount).toBe(1);

      const result2 = await cache.getOrSet('key', factory);
      expect(result2).toBe('computed');
      expect(callCount).toBe(1); // factory not called again
    });

    test('キャッシュヒット時にfactoryを呼び出さないこと', async () => {
      await cache.set('key', 'existing');
      let called = false;
      const factory = async () => {
        called = true;
        return 'new';
      };

      const result = await cache.getOrSet('key', factory);
      expect(result).toBe('existing');
      expect(called).toBe(false);
    });
  });

  describe('setWithTags / invalidateByTags', () => {
    test('タグベースでキャッシュを無効化できること', async () => {
      await cache.setWithTags('user:1', { name: 'alice' }, ['users']);
      await cache.setWithTags('user:2', { name: 'bob' }, ['users']);
      await cache.setWithTags('task:1', { title: 'task' }, ['tasks']);

      await cache.invalidateByTags(['users']);

      expect(await cache.get('user:1')).toBeNull();
      expect(await cache.get('user:2')).toBeNull();
      expect(await cache.get<{ title: string }>('task:1')).toEqual({ title: 'task' });
    });

    test('複数タグの無効化ができること', async () => {
      await cache.setWithTags('item1', 'a', ['tag1', 'tag2']);
      await cache.setWithTags('item2', 'b', ['tag2']);
      await cache.setWithTags('item3', 'c', ['tag3']);

      await cache.invalidateByTags(['tag1', 'tag2']);

      expect(await cache.get('item1')).toBeNull();
      expect(await cache.get('item2')).toBeNull();
      expect(await cache.get<string>('item3')).toBe('c');
    });

    test('存在しないタグの無効化でエラーにならないこと', async () => {
      await cache.invalidateByTags(['nonexistent']); // should not throw
    });
  });

  describe('getWithStats / getStats / resetStats', () => {
    test('ヒット/ミスを正しくカウントすること', async () => {
      await cache.set('key', 'value');

      await cache.getWithStats('key'); // hit
      await cache.getWithStats('key'); // hit
      await cache.getWithStats('missing'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.total).toBe(3);
      expect(stats.hitRate).toBe('66.67%');
    });

    test('統計なしの場合0%を返すこと', () => {
      const stats = cache.getStats();
      expect(stats.total).toBe(0);
      expect(stats.hitRate).toBe('0.00%');
    });

    test('resetStatsで統計がリセットされること', async () => {
      await cache.set('key', 'value');
      await cache.getWithStats('key');
      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.total).toBe(0);
    });
  });

  describe('warmup', () => {
    test('複数キーを一括でキャッシュウォーミングできること', async () => {
      await cache.warmup([
        { key: 'a', factory: async () => 1 },
        { key: 'b', factory: async () => 2 },
        { key: 'c', factory: async () => 3 },
      ]);

      expect(await cache.get<number>('a')).toBe(1);
      expect(await cache.get<number>('b')).toBe(2);
      expect(await cache.get<number>('c')).toBe(3);
    });

    test('既存キーはfactoryを呼ばないこと', async () => {
      await cache.set('a', 'existing');
      let called = false;

      await cache.warmup([
        {
          key: 'a',
          factory: async () => {
            called = true;
            return 'new';
          },
        },
      ]);

      expect(called).toBe(false);
      expect(await cache.get<string>('a')).toBe('existing');
    });
  });
});

describe('CacheKeys', () => {
  test('taskキーが正しい形式であること', () => {
    expect(CacheKeys.task('123')).toBe('task:123');
  });

  test('taskListキーがフィルタをJSON化すること', () => {
    const key = CacheKeys.taskList({ status: 'done' });
    expect(key).toContain('tasks:');
    expect(key).toContain('done');
  });

  test('projectキーが正しい形式であること', () => {
    expect(CacheKeys.project('456')).toBe('project:456');
  });

  test('userキーが正しい形式であること', () => {
    expect(CacheKeys.user('789')).toBe('user:789');
  });

  test('statisticsキーが正しい形式であること', () => {
    expect(CacheKeys.statistics('daily')).toBe('stats:daily');
  });

  test('TTL定数が正しい値であること', () => {
    expect(CacheKeys.TTL.SHORT).toBe(60);
    expect(CacheKeys.TTL.MEDIUM).toBe(300);
    expect(CacheKeys.TTL.LONG).toBe(3600);
    expect(CacheKeys.TTL.DAY).toBe(86400);
  });
});
