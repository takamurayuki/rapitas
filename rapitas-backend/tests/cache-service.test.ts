import { describe, test, expect, beforeEach } from "bun:test";
import { CacheService, CacheKeys } from "../services/cache-service";

describe("CacheService", () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService({ strategy: "memory", keyPrefix: "test:" });
  });

  describe("基本操作", () => {
    test("set/getでデータを保存・取得できること", async () => {
      await cache.set("key1", { name: "test" });
      const result = await cache.get<{ name: string }>("key1");
      expect(result).toEqual({ name: "test" });
    });

    test("存在しないキーでnullを返すこと", async () => {
      const result = await cache.get("nonexistent");
      expect(result).toBeNull();
    });

    test("deleteでデータを削除できること", async () => {
      await cache.set("key1", "value");
      await cache.delete("key1");
      const result = await cache.get("key1");
      expect(result).toBeNull();
    });

    test("hasでキーの存在を確認できること", async () => {
      await cache.set("key1", "value");
      expect(await cache.has("key1")).toBe(true);
      expect(await cache.has("key2")).toBe(false);
    });

    test("clearで全データを削除できること", async () => {
      await cache.set("a", 1);
      await cache.set("b", 2);
      await cache.clear();
      expect(await cache.get("a")).toBeNull();
      expect(await cache.get("b")).toBeNull();
    });
  });

  describe("getOrSet", () => {
    test("キャッシュヒット時はfactoryを呼ばないこと", async () => {
      await cache.set("key1", "cached");
      let factoryCalled = false;

      const result = await cache.getOrSet("key1", async () => {
        factoryCalled = true;
        return "computed";
      });

      expect(result).toBe("cached");
      expect(factoryCalled).toBe(false);
    });

    test("キャッシュミス時はfactoryを呼んで保存すること", async () => {
      const result = await cache.getOrSet("key1", async () => "computed");

      expect(result).toBe("computed");
      expect(await cache.get("key1")).toBe("computed");
    });
  });

  describe("タグベース無効化", () => {
    test("setWithTagsでタグ付きデータを保存できること", async () => {
      await cache.setWithTags("user:1", { id: 1 }, ["users"]);
      await cache.setWithTags("user:2", { id: 2 }, ["users"]);
      await cache.setWithTags("task:1", { id: 1 }, ["tasks"]);

      expect(await cache.get("user:1")).toEqual({ id: 1 });
    });

    test("invalidateByTagsでタグ付きデータを一括削除できること", async () => {
      await cache.setWithTags("user:1", { id: 1 }, ["users"]);
      await cache.setWithTags("user:2", { id: 2 }, ["users"]);
      await cache.setWithTags("task:1", { id: 1 }, ["tasks"]);

      await cache.invalidateByTags(["users"]);

      expect(await cache.get("user:1")).toBeNull();
      expect(await cache.get("user:2")).toBeNull();
      expect(await cache.get("task:1")).toEqual({ id: 1 });
    });

    test("存在しないタグの無効化はエラーにならないこと", async () => {
      await cache.invalidateByTags(["nonexistent"]);
    });
  });

  describe("ウォーミング", () => {
    test("warmupで複数キーを一括ロードできること", async () => {
      await cache.warmup([
        { key: "a", factory: async () => 1 },
        { key: "b", factory: async () => 2 },
        { key: "c", factory: async () => 3 },
      ]);

      expect(await cache.get("a")).toBe(1);
      expect(await cache.get("b")).toBe(2);
      expect(await cache.get("c")).toBe(3);
    });
  });

  describe("統計", () => {
    test("getWithStatsでヒット/ミスがカウントされること", async () => {
      await cache.set("key1", "value");

      await cache.getWithStats("key1"); // hit
      await cache.getWithStats("key1"); // hit
      await cache.getWithStats("missing"); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.total).toBe(3);
      expect(stats.hitRate).toBe("66.67%");
    });

    test("resetStatsで統計がリセットされること", () => {
      cache.resetStats();
      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.total).toBe(0);
      expect(stats.hitRate).toBe("0.00%");
    });

    test("ヒット0件の場合0%になること", () => {
      cache.resetStats();
      const stats = cache.getStats();
      expect(stats.hitRate).toBe("0.00%");
    });
  });
});

describe("CacheKeys", () => {
  test("各キー生成関数が正しいフォーマットを返すこと", () => {
    expect(CacheKeys.task("123")).toBe("task:123");
    expect(CacheKeys.project("456")).toBe("project:456");
    expect(CacheKeys.user("789")).toBe("user:789");
    expect(CacheKeys.statistics("daily")).toBe("stats:daily");
  });

  test("taskListがフィルターをJSON化すること", () => {
    const key = CacheKeys.taskList({ status: "done" });
    expect(key).toContain("tasks:");
    expect(key).toContain("done");
  });

  test("TTL定数が正しいこと", () => {
    expect(CacheKeys.TTL.SHORT).toBe(60);
    expect(CacheKeys.TTL.MEDIUM).toBe(300);
    expect(CacheKeys.TTL.LONG).toBe(3600);
    expect(CacheKeys.TTL.DAY).toBe(86400);
  });
});
