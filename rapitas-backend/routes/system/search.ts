/**
 * Search API Routes
 * 横断的な全文検索エンドポイント
 */
import { Elysia, t } from "elysia";
import { prisma } from "../../config/database";

type SearchResultItem = {
  id: number;
  type: "task" | "comment" | "note" | "resource";
  title: string;
  excerpt: string;
  relevance: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt?: Date;
};

/**
 * テキストからマッチ箇所の前後を抽出してexcerptを生成
 */
function createExcerpt(text: string, query: string, maxLength = 200): string {
  if (!text) return "";
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) {
    return text.length > maxLength ? text.slice(0, maxLength) + "..." : text;
  }

  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + query.length + 150);
  let excerpt = text.slice(start, end);

  if (start > 0) excerpt = "..." + excerpt;
  if (end < text.length) excerpt = excerpt + "...";

  return excerpt;
}

/**
 * 簡易的な関連度スコア計算
 */
function calculateRelevance(text: string, query: string): number {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const words = lowerQuery.split(/\s+/);

  let score = 0;

  // タイトル完全一致: 最高スコア
  if (lowerText === lowerQuery) return 100;

  // タイトル先頭一致
  if (lowerText.startsWith(lowerQuery)) score += 50;

  // 各ワードの出現回数
  for (const word of words) {
    if (!word) continue;
    const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = text.match(regex);
    if (matches) {
      score += matches.length * 10;
    }
  }

  return Math.min(score, 100);
}

export const searchRoutes = new Elysia({ prefix: "/search" })
  // 横断検索
  .get(
    "/",
    async ({ query: q, set }) => {
      try {
        const searchQuery = q.q?.trim();
        if (!searchQuery || searchQuery.length < 1) {
          set.status = 400;
          return { success: false, error: "検索クエリが必要です" };
        }

        // 検索文字列の長さ制限
        if (searchQuery.length > 500) {
          set.status = 400;
          return { success: false, error: "検索クエリが長すぎます（最大500文字）" };
        }

        const types = q.type?.split(",") || ["task", "comment", "note", "resource"];
        const limit = q.limit ? Math.min(parseInt(q.limit), 100) : 20;
        const offset = q.offset ? parseInt(q.offset) : 0;

        const results: SearchResultItem[] = [];

        // タスク検索: タイトル+説明文
        if (types.includes("task")) {
          const tasks = await prisma.task.findMany({
            where: {
              OR: [
                { title: { contains: searchQuery, mode: "insensitive" } },
                { description: { contains: searchQuery, mode: "insensitive" } },
              ],
            },
            include: {
              theme: { select: { id: true, name: true, color: true } },
              taskLabels: { include: { label: true } },
            },
            take: limit,
            orderBy: { updatedAt: "desc" },
          });

          for (const task of tasks) {
            const titleRelevance = calculateRelevance(task.title, searchQuery);
            const descRelevance = task.description
              ? calculateRelevance(task.description, searchQuery) * 0.7
              : 0;

            results.push({
              id: task.id,
              type: "task",
              title: task.title,
              excerpt: task.description
                ? createExcerpt(task.description, searchQuery)
                : "",
              relevance: Math.max(titleRelevance, descRelevance),
              metadata: {
                status: task.status,
                priority: task.priority,
                theme: task.theme,
                labels: task.taskLabels.map((tl) => tl.label),
                dueDate: task.dueDate,
              },
              createdAt: task.createdAt,
              updatedAt: task.updatedAt,
            });
          }
        }

        // コメント検索
        if (types.includes("comment")) {
          const comments = await prisma.comment.findMany({
            where: {
              content: { contains: searchQuery, mode: "insensitive" },
            },
            include: {
              task: { select: { id: true, title: true } },
            },
            take: limit,
            orderBy: { updatedAt: "desc" },
          });

          for (const comment of comments) {
            results.push({
              id: comment.id,
              type: "comment",
              title: comment.task
                ? `Comment on: ${comment.task.title}`
                : `Comment #${comment.id}`,
              excerpt: createExcerpt(comment.content, searchQuery),
              relevance: calculateRelevance(comment.content, searchQuery) * 0.6,
              metadata: {
                taskId: comment.taskId,
                taskTitle: comment.task?.title,
              },
              createdAt: comment.createdAt,
              updatedAt: comment.updatedAt,
            });
          }
        }

        // リソース検索
        if (types.includes("resource")) {
          const resources = await prisma.resource.findMany({
            where: {
              OR: [
                { title: { contains: searchQuery, mode: "insensitive" } },
                { description: { contains: searchQuery, mode: "insensitive" } },
              ],
            },
            include: {
              task: { select: { id: true, title: true } },
            },
            take: limit,
            orderBy: { updatedAt: "desc" },
          });

          for (const resource of resources) {
            const titleRelevance = calculateRelevance(resource.title, searchQuery);
            const descRelevance = resource.description
              ? calculateRelevance(resource.description, searchQuery) * 0.7
              : 0;

            results.push({
              id: resource.id,
              type: "resource",
              title: resource.title,
              excerpt: resource.description
                ? createExcerpt(resource.description, searchQuery)
                : "",
              relevance: Math.max(titleRelevance, descRelevance),
              metadata: {
                resourceType: resource.type,
                url: resource.url,
                taskId: resource.taskId,
                taskTitle: resource.task?.title,
              },
              createdAt: resource.createdAt,
              updatedAt: resource.updatedAt,
            });
          }
        }

        // 関連度でソート
        results.sort((a, b) => b.relevance - a.relevance);

        // ページネーション適用
        const paginatedResults = results.slice(offset, offset + limit);
        const total = results.length;

        return {
          success: true,
          query: searchQuery,
          results: paginatedResults,
          total,
          limit,
          offset,
        };
      } catch (error) {
        console.error("Search error:", error);
        set.status = 500;
        return { success: false, error: "検索に失敗しました" };
      }
    }
  )

  // 検索サジェスト（タイトルのみ、高速）
  .get("/suggest", async ({ query: q, set }) => {
    try {
      const searchQuery = q.q?.trim();
      if (!searchQuery || searchQuery.length < 1) {
        return { success: true, suggestions: [] };
      }

      const tasks = await prisma.task.findMany({
        where: {
          title: { contains: searchQuery, mode: "insensitive" },
        },
        select: { id: true, title: true, status: true },
        take: 8,
        orderBy: { updatedAt: "desc" },
      });

      return {
        success: true,
        suggestions: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          type: "task" as const,
          status: t.status,
        })),
      };
    } catch (error) {
      console.error("Search suggest error:", error);
      set.status = 500;
      return { success: false, error: "サジェスト取得に失敗しました" };
    }
  });
