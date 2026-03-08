/**
 * Search Index Service
 * 検索インデックスの構築・関連度検索・キャッシュ管理
 */
import { prisma } from "../config/database";
import { createLogger } from "../config/logger";

const log = createLogger("search-index-service");

interface SearchIndexEntry {
  id: number;
  type: "task" | "comment" | "resource";
  title: string;
  content: string;
  updatedAt: Date;
}

const indexCache = new Map<string, SearchIndexEntry[]>();
let lastBuildTime: Date | null = null;

/**
 * 検索インデックスを構築する
 */
export async function buildSearchIndex(): Promise<number> {
  log.info("Building search index");

  const [tasks, comments, resources] = await Promise.all([
    prisma.task.findMany({
      select: { id: true, title: true, description: true, updatedAt: true },
    }),
    prisma.comment.findMany({
      select: { id: true, content: true, updatedAt: true },
    }),
    prisma.resource.findMany({
      select: { id: true, title: true, url: true, updatedAt: true },
    }),
  ]);

  const entries: SearchIndexEntry[] = [
    ...tasks.map((t) => ({
      id: t.id,
      type: "task" as const,
      title: t.title,
      content: t.description ?? "",
      updatedAt: t.updatedAt,
    })),
    ...comments.map((c) => ({
      id: c.id,
      type: "comment" as const,
      title: "",
      content: c.content,
      updatedAt: c.updatedAt,
    })),
    ...resources.map((r) => ({
      id: r.id,
      type: "resource" as const,
      title: r.title ?? "",
      content: r.url ?? "",
      updatedAt: r.updatedAt,
    })),
  ];

  indexCache.set("all", entries);
  lastBuildTime = new Date();
  log.info({ count: entries.length }, "Search index built");
  return entries.length;
}

/**
 * 関連度に基づいて検索する
 */
export function searchByRelevance(
  query: string,
  limit = 20,
): SearchIndexEntry[] {
  const entries = indexCache.get("all") ?? [];
  const lowerQuery = query.toLowerCase();

  const scored = entries
    .map((entry) => {
      let score = 0;
      if (entry.title.toLowerCase().includes(lowerQuery)) score += 10;
      if (entry.content.toLowerCase().includes(lowerQuery)) score += 5;
      if (entry.title.toLowerCase().startsWith(lowerQuery)) score += 5;
      return { entry, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((s) => s.entry);
}

/**
 * 検索キャッシュをクリアする
 */
export function clearSearchCache(): void {
  indexCache.clear();
  lastBuildTime = null;
  log.info("Search cache cleared");
}
