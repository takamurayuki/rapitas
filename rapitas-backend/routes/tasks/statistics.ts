import { Elysia } from "elysia";
import { prisma } from "../../config/database";

/**
 * タスク統計エンドポイント
 * キャッシュヘッダー付きで統計情報を提供
 */
export const taskStatisticsRoutes = new Elysia({ prefix: "/tasks" })
  .get(
    "/statistics",
    async ({ set }) => {
      const [total, byStatus, byCategory, recent] = await Promise.all([
        // 総タスク数
        prisma.task.count(),

        // ステータス別集計
        prisma.task.groupBy({
          by: ["status"],
          _count: true,
        }),

        // カテゴリ別集計
        prisma.task.groupBy({
          by: ["categoryId"],
          _count: true,
        }),

        // 最近の完了タスク
        prisma.task.count({
          where: {
            completedAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 過去7日間
            },
          },
        }),
      ]);

      const statistics = {
        total,
        byStatus: byStatus.reduce(
          (acc, item) => ({
            ...acc,
            [item.status]: item._count,
          }),
          { todo: 0, "in-progress": 0, done: 0 }
        ),
        byCategory: byCategory.reduce(
          (acc, item) => ({
            ...acc,
            [item.categoryId]: item._count,
          }),
          {}
        ),
        recentlyCompleted: recent,
      };

      // キャッシュヘッダーを設定（5分間）
      set.headers = {
        "Cache-Control": "public, max-age=300",
        "ETag": `W/"${Buffer.from(JSON.stringify(statistics)).toString('base64')}"`,
      };

      return statistics;
    },
    {
      detail: {
        tags: ["Tasks"],
        summary: "Get task statistics",
        description: "Returns aggregated statistics about tasks with caching",
      },
    }
  )

  .get(
    "/recent",
    async ({ query, set }) => {
      const limit = Math.min(parseInt(query.limit || "10"), 50);

      const recentTasks = await prisma.task.findMany({
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          categoryId: true,
          updatedAt: true,
        },
      });

      // キャッシュヘッダーを設定（1分間）
      set.headers = {
        "Cache-Control": "private, max-age=60",
      };

      return recentTasks;
    },
    {
      detail: {
        tags: ["Tasks"],
        summary: "Get recent tasks",
        description: "Returns recently updated tasks",
      },
    }
  );