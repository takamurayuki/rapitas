/**
 * Task Dependency Graph API Routes
 *
 * ユーザー宣言的なタスク依存関係の管理 API
 *
 * NOTE: このファイルは宣言的依存関係（ユーザーが手動で作成）を扱います。
 * ファイルパス自動解析による依存関係は routes/tasks/task-dependency.ts を参照。
 */

import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import {
  addDependency,
  removeDependency,
  removeDependencyById,
  getDependenciesForTask,
  getUnblockedTasks,
} from '../../services/task/task-dependency-service';
// NOTE: topologicalSort/calculateCriticalPath expect Map<number,TaskNode> from
// the parallel-execution system. For the Gantt endpoint we just order by
// dependency depth — full graph algorithms are overkill for display sorting.

export const taskDependencyGraphRoutes = new Elysia({ prefix: '/tasks' })
  // 特定タスクの依存関係を取得
  .get(
    '/:id/dependencies',
    async ({ params }) => {
      const taskId = parseInt(params.id);
      if (isNaN(taskId)) {
        throw new Error('Invalid task ID');
      }

      return await getDependenciesForTask(taskId);
    },
    {
      detail: {
        tags: ['Tasks', 'Dependencies'],
        summary: 'タスクの依存関係を取得',
        description:
          '指定したタスクがブロックしているタスクと、このタスクをブロックしているタスクを取得',
      },
    },
  )

  // タスク依存関係を追加
  .post(
    '/:id/dependencies',
    async ({ params, body }) => {
      const toTaskId = parseInt(params.id);
      const { blockedById, type = 'FS', lagDays = 0 } = body;

      if (isNaN(toTaskId) || isNaN(blockedById)) {
        throw new Error('Invalid task IDs');
      }

      return await addDependency(blockedById, toTaskId, type, lagDays);
    },
    {
      body: t.Object({
        blockedById: t.Number({ description: 'このタスクをブロックするタスクのID' }),
        type: t.Optional(
          t.String({ default: 'FS', description: '依存関係タイプ (FS=Finish-to-Start)' }),
        ),
        lagDays: t.Optional(t.Number({ default: 0, description: '遅延日数' })),
      }),
      detail: {
        tags: ['Tasks', 'Dependencies'],
        summary: 'タスク依存関係を追加',
        description:
          '「blockedByIdのタスクが完了するまで、指定タスクは開始できない」という関係を追加',
      },
    },
  )

  // タスク依存関係を削除
  .delete(
    '/:id/dependencies/:depId',
    async ({ params }) => {
      const dependencyId = parseInt(params.depId);

      if (isNaN(dependencyId)) {
        throw new Error('Invalid dependency ID');
      }

      await removeDependencyById(dependencyId);
      return { success: true };
    },
    {
      detail: {
        tags: ['Tasks', 'Dependencies'],
        summary: 'タスク依存関係を削除',
        description: '指定したIDの依存関係を削除',
      },
    },
  )

  // Gantt チャート用のタスクデータを取得
  .get(
    '/gantt-data',
    async ({ query }) => {
      const { themeId, from, to, categoryId } = query;

      // クエリパラメータの構築
      const whereConditions: any = {};

      if (themeId && !isNaN(parseInt(themeId))) {
        whereConditions.themeId = parseInt(themeId);
      }

      if (categoryId && !isNaN(parseInt(categoryId))) {
        whereConditions.theme = {
          categoryId: parseInt(categoryId),
        };
      }

      // 日付フィルタ
      if (from || to) {
        whereConditions.AND = [];

        if (from) {
          whereConditions.AND.push({
            OR: [
              { dueDate: { gte: new Date(from) } },
              { dueDate: null }, // 期限がないタスクも含める
            ],
          });
        }

        if (to) {
          whereConditions.AND.push({
            OR: [
              { dueDate: { lte: new Date(to) } },
              { dueDate: null }, // 期限がないタスクも含める
            ],
          });
        }
      }

      const tasks = await prisma.task.findMany({
        where: whereConditions,
        include: {
          theme: {
            select: {
              id: true,
              name: true,
              color: true,
              category: { select: { id: true, name: true } },
            },
          },
          outgoingDependencies: {
            select: {
              id: true,
              toTaskId: true,
              type: true,
              lagDays: true,
            },
          },
          incomingDependencies: {
            select: {
              id: true,
              fromTaskId: true,
              type: true,
              lagDays: true,
            },
          },
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      });

      // 依存関係をエッジ形式に変換
      const edges: Array<{ from: number; to: number }> = [];
      tasks.forEach((task) => {
        task.outgoingDependencies.forEach((dep) => {
          edges.push({ from: task.id, to: dep.toTaskId });
        });
      });

      // グラフアルゴリズムを適用
      const nodes = tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        dueDate: task.dueDate,
        estimatedHours: task.estimatedHours,
        theme: task.theme,
      }));

      // Simple topological sort via Kahn's algorithm (avoids the TaskNode type
      // dependency from parallel-execution/graph-algorithms).
      const inDegree = new Map<number, number>();
      const adjList = new Map<number, number[]>();
      for (const n of nodes) {
        inDegree.set(n.id, 0);
        adjList.set(n.id, []);
      }
      for (const e of edges) {
        inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
        adjList.get(e.from)?.push(e.to);
      }
      const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
      const sortedIds: number[] = [];
      while (queue.length) {
        const cur = queue.shift()!;
        sortedIds.push(cur);
        for (const next of adjList.get(cur) ?? []) {
          const nd = (inDegree.get(next) ?? 1) - 1;
          inDegree.set(next, nd);
          if (nd === 0) queue.push(next);
        }
      }
      const nodeById = new Map(nodes.map((n) => [n.id, n]));
      const sortedNodes =
        sortedIds.length === nodes.length
          ? sortedIds.map((id) => nodeById.get(id)!).filter(Boolean)
          : nodes; // fallback on cycle
      // Critical path placeholder — full critical-path analysis requires
      // estimatedHours on every node, which we often don't have. Return empty
      // for now; the frontend renders dependencies as arrows regardless.
      const criticalPath: number[] = [];

      return {
        tasks: sortedNodes,
        dependencies: edges,
        criticalPath,
        metadata: {
          totalTasks: tasks.length,
          dateRange: {
            from: from || null,
            to: to || null,
          },
          filters: {
            themeId: themeId ? parseInt(themeId) : null,
            categoryId: categoryId ? parseInt(categoryId) : null,
          },
        },
      };
    },
    {
      query: t.Object({
        themeId: t.Optional(t.String({ description: 'テーマIDでフィルタ' })),
        categoryId: t.Optional(t.String({ description: 'カテゴリIDでフィルタ' })),
        from: t.Optional(t.String({ description: '開始日 (ISO 8601 format)' })),
        to: t.Optional(t.String({ description: '終了日 (ISO 8601 format)' })),
      }),
      detail: {
        tags: ['Tasks', 'Dependencies', 'Gantt'],
        summary: 'Gantt チャート用タスクデータ',
        description: '依存関係とトポロジカルソート、クリティカルパスを含むタスクデータを取得',
      },
    },
  )

  // タスク完了時に依存先タスクのブロック解除候補を取得
  .get(
    '/:id/unblock-candidates',
    async ({ params }) => {
      const taskId = parseInt(params.id);
      if (isNaN(taskId)) {
        throw new Error('Invalid task ID');
      }

      const unblockedTaskIds = await getUnblockedTasks(taskId);

      if (unblockedTaskIds.length === 0) {
        return { candidates: [] };
      }

      const candidates = await prisma.task.findMany({
        where: { id: { in: unblockedTaskIds } },
        select: {
          id: true,
          title: true,
          status: true,
          dueDate: true,
          theme: {
            select: { id: true, name: true, color: true },
          },
        },
      });

      return { candidates };
    },
    {
      detail: {
        tags: ['Tasks', 'Dependencies'],
        summary: 'ブロック解除候補タスクを取得',
        description: '指定タスクが完了した場合にブロック解除されるタスクの一覧',
      },
    },
  );
