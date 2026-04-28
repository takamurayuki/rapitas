import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recordTaskAccess } from '../cache-warmup';

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
