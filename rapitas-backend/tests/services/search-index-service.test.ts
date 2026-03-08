/**
 * Search Index Service テスト
 * buildSearchIndex, searchByRelevance, clearSearchCacheのテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockPrisma = {
  task: {
    findMany: mock(() => Promise.resolve([])),
  },
  comment: {
    findMany: mock(() => Promise.resolve([])),
  },
  resource: {
    findMany: mock(() => Promise.resolve([])),
  },
};

mock.module("../../config/database", () => ({ prisma: mockPrisma }));
mock.module("../../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { buildSearchIndex, searchByRelevance, clearSearchCache } = await import(
  "../../services/search-index-service"
);

describe("buildSearchIndex", () => {
  beforeEach(() => {
    clearSearchCache();
    mockPrisma.task.findMany.mockReset();
    mockPrisma.comment.findMany.mockReset();
    mockPrisma.resource.findMany.mockReset();
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.comment.findMany.mockResolvedValue([]);
    mockPrisma.resource.findMany.mockResolvedValue([]);
  });

  test("空のDBで0件のインデックスを構築すること", async () => {
    const count = await buildSearchIndex();
    expect(count).toBe(0);
  });

  test("タスク・コメント・リソースを合算したインデックス数を返すこと", async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      { id: 1, title: "Task 1", description: "desc", updatedAt: new Date() },
      { id: 2, title: "Task 2", description: null, updatedAt: new Date() },
    ]);
    mockPrisma.comment.findMany.mockResolvedValue([
      { id: 1, content: "comment text", updatedAt: new Date() },
    ]);
    mockPrisma.resource.findMany.mockResolvedValue([
      { id: 1, title: "Resource", url: "https://example.com", updatedAt: new Date() },
    ]);

    const count = await buildSearchIndex();
    expect(count).toBe(4);
  });
});

describe("searchByRelevance", () => {
  beforeEach(async () => {
    clearSearchCache();
    mockPrisma.task.findMany.mockResolvedValue([
      { id: 1, title: "JavaScript Guide", description: "Learn JS basics", updatedAt: new Date() },
      { id: 2, title: "Python Tutorial", description: "Python for beginners", updatedAt: new Date() },
      { id: 3, title: "Advanced JS", description: "Deep dive into JavaScript", updatedAt: new Date() },
    ]);
    mockPrisma.comment.findMany.mockResolvedValue([]);
    mockPrisma.resource.findMany.mockResolvedValue([]);
    await buildSearchIndex();
  });

  test("タイトルに一致するエントリを返すこと", () => {
    const results = searchByRelevance("JavaScript");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.title === "JavaScript Guide")).toBe(true);
  });

  test("一致しないクエリで空配列を返すこと", () => {
    const results = searchByRelevance("Rust");
    expect(results).toEqual([]);
  });

  test("limit引数で結果数を制限できること", () => {
    const results = searchByRelevance("JavaScript", 1);
    expect(results.length).toBe(1);
  });
});

describe("clearSearchCache", () => {
  test("キャッシュクリア後は検索結果が空になること", async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      { id: 1, title: "Cached Task", description: "", updatedAt: new Date() },
    ]);
    mockPrisma.comment.findMany.mockResolvedValue([]);
    mockPrisma.resource.findMany.mockResolvedValue([]);
    await buildSearchIndex();

    clearSearchCache();
    const results = searchByRelevance("Cached");
    expect(results).toEqual([]);
  });
});
