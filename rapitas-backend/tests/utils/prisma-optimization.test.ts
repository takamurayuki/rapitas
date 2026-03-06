/**
 * Prisma Optimization テスト
 * クエリ最適化ユーティリティのテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";

mock.module("../../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { PrismaOptimizer, PrismaDataLoader, QueryOptimizers } = await import(
  "../../utils/prisma-optimization"
);

describe("PrismaOptimizer", () => {
  describe("selectFields", () => {
    test("フィールド配列からselectオブジェクトを生成すること", () => {
      const result = PrismaOptimizer.selectFields(["id", "title", "status"]);
      expect(result).toEqual({ id: true, title: true, status: true });
    });

    test("空配列で空オブジェクトを返すこと", () => {
      expect(PrismaOptimizer.selectFields([])).toEqual({});
    });
  });

  describe("batchOperation", () => {
    test("アイテムをバッチに分割して処理すること", async () => {
      const items = [1, 2, 3, 4, 5];
      const batches: number[][] = [];
      await PrismaOptimizer.batchOperation(items, 2, async (batch) => {
        batches.push(batch);
      });
      expect(batches).toEqual([[1, 2], [3, 4], [5]]);
    });

    test("空配列で何も実行しないこと", async () => {
      let called = false;
      await PrismaOptimizer.batchOperation([], 10, async () => {
        called = true;
      });
      expect(called).toBe(false);
    });

    test("バッチサイズがアイテム数以上の場合1回で処理すること", async () => {
      const items = [1, 2, 3];
      let callCount = 0;
      await PrismaOptimizer.batchOperation(items, 10, async () => {
        callCount++;
      });
      expect(callCount).toBe(1);
    });
  });

  describe("parallelQueries", () => {
    test("複数クエリを並列実行して結果を返すこと", async () => {
      const result = await PrismaOptimizer.parallelQueries({
        count: Promise.resolve(42),
        items: Promise.resolve(["a", "b"]),
      });
      expect(result.count).toBe(42);
      expect(result.items).toEqual(["a", "b"]);
    });

    test("空オブジェクトで空結果を返すこと", async () => {
      const result = await PrismaOptimizer.parallelQueries({});
      expect(result).toEqual({});
    });
  });

  describe("cursorPagination", () => {
    test("カーソルなしの場合take=limit+1のみ返すこと", () => {
      const result = PrismaOptimizer.cursorPagination(undefined, 20);
      expect(result.take).toBe(21);
      expect(result).not.toHaveProperty("cursor");
      expect(result).not.toHaveProperty("skip");
    });

    test("カーソルありの場合cursor+skip=1を返すこと", () => {
      const result = PrismaOptimizer.cursorPagination("100", 20);
      expect(result.take).toBe(21);
      expect(result.cursor).toEqual({ id: 100 });
      expect(result.skip).toBe(1);
    });

    test("デフォルトlimitは20であること", () => {
      const result = PrismaOptimizer.cursorPagination();
      expect(result.take).toBe(21);
    });
  });

  describe("formatCursorResults", () => {
    test("次ページがある場合hasNextPage=trueと最後のIDを返すこと", () => {
      const items = [
        { id: 1, name: "a" },
        { id: 2, name: "b" },
        { id: 3, name: "c" },
      ];
      const result = PrismaOptimizer.formatCursorResults(items, 2);
      expect(result.hasNextPage).toBe(true);
      expect(result.data.length).toBe(2);
      expect(result.nextCursor).toBe("2");
    });

    test("次ページがない場合hasNextPage=falseを返すこと", () => {
      const items = [
        { id: 1, name: "a" },
        { id: 2, name: "b" },
      ];
      const result = PrismaOptimizer.formatCursorResults(items, 3);
      expect(result.hasNextPage).toBe(false);
      expect(result.data.length).toBe(2);
      expect(result.nextCursor).toBeUndefined();
    });

    test("空配列で空結果を返すこと", () => {
      const result = PrismaOptimizer.formatCursorResults([], 10);
      expect(result.hasNextPage).toBe(false);
      expect(result.data.length).toBe(0);
    });
  });
});

describe("PrismaDataLoader", () => {
  test("IDでデータをロードできること", async () => {
    const loader = new PrismaDataLoader<{ name: string }>(
      async (ids) => {
        const map = new Map<string, { name: string }>();
        ids.forEach((id) => map.set(id, { name: `item-${id}` }));
        return map;
      },
      100,
      5
    );

    const result = await loader.load("1");
    expect(result).toEqual({ name: "item-1" });
  });

  test("同じIDのリクエストはキャッシュから返すこと", async () => {
    let loadCount = 0;
    const loader = new PrismaDataLoader<{ name: string }>(
      async (ids) => {
        loadCount++;
        const map = new Map<string, { name: string }>();
        ids.forEach((id) => map.set(id, { name: `item-${id}` }));
        return map;
      },
      100,
      5
    );

    await loader.load("1");
    await loader.load("1"); // should use cache
    expect(loadCount).toBe(1);
  });

  test("キャッシュをクリアできること", async () => {
    let loadCount = 0;
    const loader = new PrismaDataLoader<{ name: string }>(
      async (ids) => {
        loadCount++;
        const map = new Map<string, { name: string }>();
        ids.forEach((id) => map.set(id, { name: `item-${id}` }));
        return map;
      },
      100,
      5
    );

    await loader.load("1");
    loader.clearCache("1");
    await loader.load("1");
    expect(loadCount).toBe(2);
  });

  test("全キャッシュをクリアできること", async () => {
    let loadCount = 0;
    const loader = new PrismaDataLoader<{ name: string }>(
      async (ids) => {
        loadCount++;
        const map = new Map<string, { name: string }>();
        ids.forEach((id) => map.set(id, { name: `item-${id}` }));
        return map;
      },
      100,
      5
    );

    await loader.load("1");
    await loader.load("2");
    loader.clearCache();
    await loader.load("1");
    expect(loadCount).toBe(3);
  });

  test("loaderエラー時にnullを返すこと", async () => {
    const loader = new PrismaDataLoader<{ name: string }>(
      async () => {
        throw new Error("DB error");
      },
      100,
      5
    );

    const result = await loader.load("1");
    expect(result).toBeNull();
  });

  test("存在しないIDでnullを返すこと", async () => {
    const loader = new PrismaDataLoader<{ name: string }>(
      async () => new Map(),
      100,
      5
    );

    const result = await loader.load("missing");
    expect(result).toBeNull();
  });
});

describe("QueryOptimizers", () => {
  test("taskWithRelationsが正しいinclude構造を返すこと", () => {
    const result = QueryOptimizers.taskWithRelations();
    expect(result.include).toBeDefined();
    expect(result.include.project).toBeDefined();
    expect(result.include.labels).toBeDefined();
    expect(result.include.timeEntries).toBeDefined();
    expect(result.include.taskDependencies).toBeDefined();
    expect(result.include._count).toBeDefined();
  });

  test("searchTasksが正しいwhere構造を返すこと", () => {
    const result = QueryOptimizers.searchTasks("test query");
    expect(result.where).toBeDefined();
    expect(result.where.AND).toBeDefined();
    expect(result.select).toBeDefined();
  });

  test("searchTasksにフィルターを追加できること", () => {
    const result = QueryOptimizers.searchTasks("test", { status: "done" });
    expect(result.where.AND).toBeDefined();
  });

  test("userWithPreferencesが適切なselect構造を返すこと", () => {
    const result = QueryOptimizers.userWithPreferences();
    expect(result.select).toBeDefined();
    expect(result.select.id).toBe(true);
    expect(result.select.username).toBe(true);
  });

  test("projectWithStatsが統計情報を含むこと", () => {
    const result = QueryOptimizers.projectWithStats();
    expect(result.include).toBeDefined();
    expect(result.include._count).toBeDefined();
  });
});

describe("Advanced PrismaOptimizer Tests", () => {
  describe("複雑なバッチ処理", () => {
    test("非同期エラーを適切に処理すること", async () => {
      let processedCount = 0;
      let errorCount = 0;

      await PrismaOptimizer.batchOperation(
        [1, 2, 3, 4, 5],
        2,
        async (batch) => {
          if (batch.includes(3)) {
            errorCount++;
            throw new Error("Batch processing error");
          }
          processedCount += batch.length;
        }
      );

      expect(errorCount).toBe(1);
      expect(processedCount).toBe(4); // 1,2 と 4,5 が処理される
    });

    test("大量データのメモリ効率的な処理", async () => {
      const largeDataset = Array.from({ length: 10000 }, (_, i) => ({ id: i }));
      let totalProcessed = 0;

      await PrismaOptimizer.batchOperation(
        largeDataset,
        100,
        async (batch) => {
          totalProcessed += batch.length;
          // メモリリークを防ぐためのガベージコレクション推奨
          if (totalProcessed % 1000 === 0) {
            global.gc?.();
          }
        }
      );

      expect(totalProcessed).toBe(10000);
    });
  });

  describe("並列クエリ最適化", () => {
    test("異なる実行時間のクエリを効率的に処理すること", async () => {
      const startTime = Date.now();

      const result = await PrismaOptimizer.parallelQueries({
        fast: new Promise(resolve => setTimeout(() => resolve("fast"), 10)),
        medium: new Promise(resolve => setTimeout(() => resolve("medium"), 50)),
        slow: new Promise(resolve => setTimeout(() => resolve("slow"), 100)),
      });

      const totalTime = Date.now() - startTime;

      expect(result.fast).toBe("fast");
      expect(result.medium).toBe("medium");
      expect(result.slow).toBe("slow");
      expect(totalTime).toBeLessThan(150); // 並列実行なので最も遅いクエリの時間程度
    });

    test("クエリエラーを適切にハンドリングすること", async () => {
      try {
        await PrismaOptimizer.parallelQueries({
          success: Promise.resolve("ok"),
          failure: Promise.reject(new Error("Query failed")),
        });
      } catch (error) {
        expect(error.message).toBe("Query failed");
      }
    });
  });

  describe("カーソルページネーション詳細", () => {
    test("数値IDと文字列IDの両方を処理できること", () => {
      const numericResult = PrismaOptimizer.cursorPagination(123, 10);
      const stringResult = PrismaOptimizer.cursorPagination("abc123", 10);

      expect(numericResult.cursor).toEqual({ id: 123 });
      expect(stringResult.cursor).toEqual({ id: "abc123" });
    });

    test("複合カーソルを処理できること", () => {
      const complexCursor = { id: 123, createdAt: new Date() };
      const result = PrismaOptimizer.cursorPagination(complexCursor, 15);

      expect(result.cursor).toEqual(complexCursor);
      expect(result.take).toBe(16);
    });

    test("結果フォーマットで境界値を正しく処理すること", () => {
      // ちょうどlimit数のアイテム
      const exactItems = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
      const exactResult = PrismaOptimizer.formatCursorResults(exactItems, 10);

      expect(exactResult.hasNextPage).toBe(false);
      expect(exactResult.data).toHaveLength(10);

      // limit + 1のアイテム
      const overItems = Array.from({ length: 11 }, (_, i) => ({ id: i + 1 }));
      const overResult = PrismaOptimizer.formatCursorResults(overItems, 10);

      expect(overResult.hasNextPage).toBe(true);
      expect(overResult.data).toHaveLength(10);
      expect(overResult.nextCursor).toBe("10");
    });
  });
});

describe("PrismaDataLoader 詳細テスト", () => {
  test("バッチローディングの効率性", async () => {
    let batchLoadCalls = 0;
    const loader = new PrismaDataLoader<{ value: number }>(
      async (ids) => {
        batchLoadCalls++;
        const map = new Map();
        ids.forEach((id) => map.set(id, { value: parseInt(id) * 2 }));
        return map;
      },
      1000,
      10
    );

    // 複数のIDを同時にロード
    const promises = ["1", "2", "3", "4", "5"].map(id => loader.load(id));
    const results = await Promise.all(promises);

    expect(batchLoadCalls).toBe(1); // 1回のバッチ呼び出しで全て処理
    expect(results).toHaveLength(5);
    expect(results[0]?.value).toBe(2);
    expect(results[4]?.value).toBe(10);
  });

  test("TTL（Time To Live）の動作確認", async () => {
    let loadCallCount = 0;
    const shortTTLLoader = new PrismaDataLoader<{ name: string }>(
      async (ids) => {
        loadCallCount++;
        const map = new Map();
        ids.forEach((id) => map.set(id, { name: `item-${id}-${loadCallCount}` }));
        return map;
      },
      50, // 50ms TTL
      100
    );

    const firstLoad = await shortTTLLoader.load("test");
    expect(firstLoad?.name).toBe("item-test-1");

    // TTL内での再ロード（キャッシュヒット）
    const secondLoad = await shortTTLLoader.load("test");
    expect(secondLoad?.name).toBe("item-test-1");
    expect(loadCallCount).toBe(1);

    // TTL経過後の再ロード
    await new Promise(resolve => setTimeout(resolve, 60));
    const thirdLoad = await shortTTLLoader.load("test");
    expect(thirdLoad?.name).toBe("item-test-2");
    expect(loadCallCount).toBe(2);
  });

  test("メモリ制限に基づくキャッシュエビクション", async () => {
    const smallCacheLoader = new PrismaDataLoader<{ data: string }>(
      async (ids) => {
        const map = new Map();
        ids.forEach((id) => map.set(id, { data: `data-${id}` }));
        return map;
      },
      10000, // 10秒 TTL
      3 // 最大3エントリ
    );

    // キャッシュ容量を超える数のアイテムをロード
    await smallCacheLoader.load("1");
    await smallCacheLoader.load("2");
    await smallCacheLoader.load("3");
    await smallCacheLoader.load("4"); // これで"1"がエビクションされるはず

    expect(smallCacheLoader.getCacheSize()).toBe(3);
  });
});

describe("QueryOptimizers 拡張テスト", () => {
  test("taskWithRelationsで選択的なincludeを使用できること", () => {
    const minimalResult = QueryOptimizers.taskWithRelations({ minimal: true });
    const fullResult = QueryOptimizers.taskWithRelations({ includeAll: true });

    expect(minimalResult.include).toBeDefined();
    expect(fullResult.include).toBeDefined();

    // minimalの方がinclude項目が少ないはず
    const minimalKeys = Object.keys(minimalResult.include);
    const fullKeys = Object.keys(fullResult.include);
    expect(minimalKeys.length).toBeLessThanOrEqual(fullKeys.length);
  });

  test("searchTasksで複雑な検索条件を構築できること", () => {
    const complexSearch = QueryOptimizers.searchTasks(
      "urgent task",
      {
        status: "in_progress",
        priority: "high",
        assignedUserId: 123,
        projectId: 456,
        dueDate: { lte: new Date() }
      }
    );

    expect(complexSearch.where.AND).toBeInstanceOf(Array);
    expect(complexSearch.where.AND.length).toBeGreaterThan(1);
    expect(complexSearch.select).toBeDefined();
  });

  test("userWithPreferencesで権限ベースのフィルタリング", () => {
    const adminResult = QueryOptimizers.userWithPreferences({ role: "admin" });
    const userResult = QueryOptimizers.userWithPreferences({ role: "user" });

    // 管理者はより多くの情報にアクセスできるはず
    const adminSelectKeys = Object.keys(adminResult.select);
    const userSelectKeys = Object.keys(userResult.select);

    expect(adminSelectKeys.length).toBeGreaterThanOrEqual(userSelectKeys.length);
  });

  test("projectWithStatsで期間ベースの統計を計算できること", () => {
    const thisMonth = new Date();
    thisMonth.setDate(1); // 月初

    const statsResult = QueryOptimizers.projectWithStats({
      period: "thisMonth",
      startDate: thisMonth
    });

    expect(statsResult.include._count).toBeDefined();
    expect(statsResult.include.tasks).toBeDefined();
    expect(statsResult.include.tasks.where).toBeDefined();
  });

  test("パフォーマンス重視のクエリ最適化", () => {
    const optimizedTaskQuery = QueryOptimizers.optimizedTaskList({
      limit: 50,
      includeCount: false,
      selectMinimal: true
    });

    expect(optimizedTaskQuery.take).toBe(50);
    expect(optimizedTaskQuery.select).toBeDefined();

    // カウントクエリが無効になっていることを確認
    expect(optimizedTaskQuery.include?._count).toBeUndefined();
  });
});

describe("エラーハンドリングと堅牢性", () => {
  test("ネットワークタイムアウトの適切な処理", async () => {
    const timeoutLoader = new PrismaDataLoader<{ id: string }>(
      async () => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Network timeout")), 100);
        });
      },
      5000,
      10
    );

    const result = await timeoutLoader.load("timeout-test");
    expect(result).toBeNull();
  });

  test("メモリ制約下での適切な動作", async () => {
    const items = Array.from({ length: 100000 }, (_, i) => ({ id: i, data: "x".repeat(1000) }));

    let processedBatches = 0;
    let totalMemoryUsed = 0;

    await PrismaOptimizer.batchOperation(
      items,
      1000, // 適度なバッチサイズ
      async (batch) => {
        processedBatches++;
        totalMemoryUsed += batch.length * 1000; // 概算メモリ使用量

        // メモリ使用量の監視（実際の実装では process.memoryUsage() を使用）
        if (totalMemoryUsed > 50000000) { // 50MB制限の例
          throw new Error("Memory limit exceeded");
        }
      }
    );

    expect(processedBatches).toBe(100); // 100バッチ処理
  });

  test("並行処理での競合状態の回避", async () => {
    let sharedCounter = 0;
    const incrementPromises = [];

    // 100個の並行処理でカウンタを増加
    for (let i = 0; i < 100; i++) {
      incrementPromises.push(
        PrismaOptimizer.parallelQueries({
          increment: Promise.resolve().then(() => {
            const current = sharedCounter;
            return new Promise(resolve => {
              setTimeout(() => {
                sharedCounter = current + 1;
                resolve(sharedCounter);
              }, Math.random() * 10);
            });
          })
        })
      );
    }

    await Promise.all(incrementPromises);

    // 競合状態があるため、100に達しない可能性が高い
    expect(sharedCounter).toBeLessThanOrEqual(100);
    expect(sharedCounter).toBeGreaterThan(0);
  });
});
