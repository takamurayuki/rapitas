import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordTaskAccess,
  warmupApplicationCache,
  getCacheStatistics,
  cleanupExpiredCache,
} from '../cache-warmup';

const mockApiFetch = vi.fn();
const mockGetCacheStats = vi.fn();
vi.mock('../api-client', () => ({
  apiClient: {
    fetch: (...args: unknown[]) => mockApiFetch(...args),
    getCacheStats: (...args: unknown[]) => mockGetCacheStats(...args),
  },
}));

const mockCacheManagerStats = vi.fn();
vi.mock('../cache-utils', () => ({
  cacheManager: {
    getCacheStats: (...args: unknown[]) => mockCacheManagerStats(...args),
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe('warmupApplicationCache', () => {
  beforeEach(() => {
    localStorage.clear();
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValue({});
  });

  it('設定・コアエンドポイント・アクティブタスクを事前フェッチすること', async () => {
    await warmupApplicationCache();

    const paths = mockApiFetch.mock.calls.map((c) => c[0]);
    expect(paths).toContain('/settings');
    expect(paths).toContain('/categories');
    expect(paths).toContain('/labels');
    expect(paths).toContain('/themes');
    expect(paths).toContain('/agents');
    expect(paths).toContain('/templates');
    expect(paths).toContain('/tasks?status=todo,progress');
  });

  it('最近アクセスしたタスク（最大10件）を事前フェッチすること', async () => {
    localStorage.setItem(
      'rapitas-recent-tasks',
      JSON.stringify({ ids: Array.from({ length: 15 }, (_, i) => i + 1) }),
    );

    await warmupApplicationCache();

    const taskPaths = mockApiFetch.mock.calls
      .map((c) => c[0] as string)
      .filter((p) => /^\/tasks\/\d+$/.test(p));
    expect(taskPaths).toHaveLength(10);
    expect(taskPaths).toEqual([
      '/tasks/1',
      '/tasks/2',
      '/tasks/3',
      '/tasks/4',
      '/tasks/5',
      '/tasks/6',
      '/tasks/7',
      '/tasks/8',
      '/tasks/9',
      '/tasks/10',
    ]);
  });

  it('最近アクセスしたタスクがない場合は個別タスクをフェッチしないこと', async () => {
    await warmupApplicationCache();

    const taskPaths = mockApiFetch.mock.calls
      .map((c) => c[0] as string)
      .filter((p) => /^\/tasks\/\d+$/.test(p));
    expect(taskPaths).toHaveLength(0);
  });

  it('フェッチが失敗しても例外を投げない（non-critical）こと', async () => {
    mockApiFetch.mockRejectedValue(new Error('network down'));

    await expect(warmupApplicationCache()).resolves.toBeUndefined();
  });

  it('最近のタスクリストが破損したJSONの場合も空扱いで継続すること', async () => {
    localStorage.setItem('rapitas-recent-tasks', 'not-json');

    await expect(warmupApplicationCache()).resolves.toBeUndefined();
    const taskPaths = mockApiFetch.mock.calls
      .map((c) => c[0] as string)
      .filter((p) => /^\/tasks\/\d+$/.test(p));
    expect(taskPaths).toHaveLength(0);
  });
});

describe('getCacheStatistics', () => {
  beforeEach(() => {
    mockGetCacheStats.mockReset();
    mockCacheManagerStats.mockReset();
  });

  it('apiClientとcacheManagerの統計を合算すること', async () => {
    mockGetCacheStats.mockReturnValue({ size: 100, entries: [{ key: 'a', size: 100, age: 0 }] });
    mockCacheManagerStats.mockReturnValue({ size: 50, entries: [{ key: 'b', size: 50, age: 0 }] });

    const stats = await getCacheStatistics();

    expect(stats.totalSize).toBe(150);
    expect(stats.totalEntries).toBe(2);
    expect(stats.apiClient.size).toBe(100);
    expect(stats.cacheManager.size).toBe(50);
  });
});

describe('cleanupExpiredCache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('期限切れエントリを除去し、期限内エントリは残すこと', () => {
    const now = Date.now();
    localStorage.setItem(
      'rapitas-api-cache',
      JSON.stringify({
        fresh: { data: 1, timestamp: now, expiry: now + 100000 },
        stale: { data: 2, timestamp: now - 200000, expiry: now - 1 },
      }),
    );

    cleanupExpiredCache();

    const cleaned = JSON.parse(localStorage.getItem('rapitas-api-cache')!);
    expect(cleaned.fresh).toBeTruthy();
    expect(cleaned.stale).toBeUndefined();
  });

  it('保存データがない場合は何もしないこと', () => {
    expect(() => cleanupExpiredCache()).not.toThrow();
    expect(localStorage.getItem('rapitas-api-cache')).toBeNull();
  });

  it('破損したJSONの場合も例外を投げないこと', () => {
    localStorage.setItem('rapitas-api-cache', 'not-json');
    expect(() => cleanupExpiredCache()).not.toThrow();
  });
});

describe('cache-warmup', () => {
  beforeEach(() => {
    // localStorage をクリア
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('recordTaskAccess', () => {
    it('localStorageに新しいエントリを書き込む', () => {
      const taskId = 123;
      recordTaskAccess(taskId);

      const stored = localStorage.getItem('rapitas-recent-tasks');
      expect(stored).not.toBe(null);

      const parsed = JSON.parse(stored!);
      expect(parsed.ids).toEqual([123]);
      expect(parsed.updatedAt).toBeDefined();
      expect(typeof parsed.updatedAt).toBe('number');
    });

    it('既存リストの先頭にIDを追加する', () => {
      // 初期データを設定
      localStorage.setItem(
        'rapitas-recent-tasks',
        JSON.stringify({
          ids: [456, 789],
          updatedAt: Date.now() - 1000,
        }),
      );

      const taskId = 123;
      recordTaskAccess(taskId);

      const stored = localStorage.getItem('rapitas-recent-tasks');
      const parsed = JSON.parse(stored!);

      expect(parsed.ids).toEqual([123, 456, 789]);
    });

    it('同一IDの重複を排除して先頭に移動する', () => {
      // 既存データにtaskId=456を含める
      localStorage.setItem(
        'rapitas-recent-tasks',
        JSON.stringify({
          ids: [123, 456, 789],
          updatedAt: Date.now() - 1000,
        }),
      );

      const taskId = 456;
      recordTaskAccess(taskId);

      const stored = localStorage.getItem('rapitas-recent-tasks');
      const parsed = JSON.parse(stored!);

      // 456が先頭に移動し、重複が排除される
      expect(parsed.ids).toEqual([456, 123, 789]);
    });

    it('最大20件にトリミングする', () => {
      // 20件のIDを事前に設定
      const existingIds = Array.from({ length: 20 }, (_, i) => i + 1);
      localStorage.setItem(
        'rapitas-recent-tasks',
        JSON.stringify({
          ids: existingIds,
          updatedAt: Date.now() - 1000,
        }),
      );

      const taskId = 999; // 新しいID
      recordTaskAccess(taskId);

      const stored = localStorage.getItem('rapitas-recent-tasks');
      const parsed = JSON.parse(stored!);

      // 最大20件まで、新しいIDが先頭に追加されて最後の要素が削除される
      expect(parsed.ids).toHaveLength(20);
      expect(parsed.ids[0]).toBe(999);
      expect(parsed.ids[19]).toBe(19); // 最後の要素は20が削除されて19
    });

    it('localStorageのJSON破損時にクラッシュしない', () => {
      // 破損したJSONを設定
      localStorage.setItem('rapitas-recent-tasks', 'invalid-json-string');

      const taskId = 123;
      expect(() => recordTaskAccess(taskId)).not.toThrow();

      // 実際の動作：破損したJSONの場合、エラーをキャッチして何も更新しない
      const stored = localStorage.getItem('rapitas-recent-tasks');
      expect(stored).toBe('invalid-json-string'); // 元の破損データが残る
    });

    it('updatedAtが現在時刻として設定される', () => {
      const beforeTime = Date.now();
      const taskId = 123;

      recordTaskAccess(taskId);

      const afterTime = Date.now();
      const stored = localStorage.getItem('rapitas-recent-tasks');
      const parsed = JSON.parse(stored!);

      expect(parsed.updatedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(parsed.updatedAt).toBeLessThanOrEqual(afterTime);
    });

    it('空のlocalStorageから開始して正しく動作する', () => {
      // localStorageが空の状態で呼び出す
      expect(localStorage.getItem('rapitas-recent-tasks')).toBe(null);

      const taskId = 999;
      recordTaskAccess(taskId);

      const stored = localStorage.getItem('rapitas-recent-tasks');
      const parsed = JSON.parse(stored!);

      expect(parsed.ids).toEqual([999]);
      expect(parsed.updatedAt).toBeDefined();
    });

    it('idsフィールドが存在しない場合でも正しく動作する', () => {
      // idsフィールドがない不正なデータを設定
      localStorage.setItem(
        'rapitas-recent-tasks',
        JSON.stringify({
          updatedAt: Date.now() - 1000,
        }),
      );

      const taskId = 777;
      recordTaskAccess(taskId);

      const stored = localStorage.getItem('rapitas-recent-tasks');
      const parsed = JSON.parse(stored!);

      expect(parsed.ids).toEqual([777]);
    });
  });
});
