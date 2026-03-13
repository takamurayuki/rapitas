/**
 * タスク専用のAPI最適化関数
 */

import {
  apiClient,
  apiFetch,
  debouncedFetch,
  parallelFetch,
} from './api-client';
import type { Task, Status } from '@/types';

type RequestOptions = {
  cacheTime?: number;
  [key: string]: unknown;
};

/**
 * タスクの一括取得（カテゴリ別）
 * 複数カテゴリのタスクを並列で取得
 */
export async function fetchTasksByCategories(
  categoryIds: number[],
): Promise<Record<number, Task[]>> {
  if (categoryIds.length === 0) return {};

  const requests = categoryIds.reduce(
    (acc, categoryId) => {
      acc[`category_${categoryId}`] = {
        path: `/tasks?categoryId=${categoryId}`,
        options: { cacheTime: 30000 }, // 30秒キャッシュ
      };
      return acc;
    },
    {} as Record<string, { path: string; options?: RequestOptions }>,
  );

  const results =
    await parallelFetch<Record<string, Task[] | { error: unknown }>>(requests);

  // レスポンスを整形
  const tasksByCategory: Record<number, Task[]> = {};
  Object.entries(results).forEach(([key, value]) => {
    const categoryId = parseInt(key.replace('category_', ''));
    if (!('error' in value)) {
      tasksByCategory[categoryId] = value as Task[];
    } else {
      tasksByCategory[categoryId] = [];
    }
  });

  return tasksByCategory;
}

/**
 * タスクのステータス一括更新
 * 複数のタスクのステータスを1回のリクエストで更新
 */
export async function updateTaskStatusBatch(
  updates: Array<{ id: number; status: Status }>,
): Promise<void> {
  await apiFetch('/tasks/batch-update-status', {
    method: 'POST',
    body: JSON.stringify({ updates }),
  });
}

/**
 * タスクの検索（デバウンス付き）
 * 検索ボックスでの入力に対応
 */
export async function searchTasks(query: string): Promise<Task[]> {
  if (!query.trim()) return [];

  return debouncedFetch<Task[]>(
    `/tasks/search?q=${encodeURIComponent(query)}`,
    { cacheTime: 60000 }, // 1分キャッシュ
    500, // 500msデバウンス
  );
}

/**
 * タスクのプリロード
 * 画面遷移前に次の画面で必要なタスクをプリロード
 */
export async function preloadTaskDetails(taskIds: number[]): Promise<void> {
  const paths = taskIds.map((id) => `/tasks/${id}`);
  await apiClient.prefetch(paths, 300000); // 5分キャッシュ
}

/**
 * タスクの統計情報取得（キャッシュ重視）
 */
export async function fetchTaskStatistics(): Promise<{
  total: number;
  byStatus: Record<Status, number>;
  byCategory: Record<number, number>;
}> {
  try {
    return await apiFetch('/tasks/statistics', {
      cacheTime: 300000, // 5分キャッシュ
    });
  } catch (error) {
    // エンドポイントがまだ実装されていない場合のフォールバック
    console.warn(
      'Statistics endpoint not available, using fallback data:',
      error,
    );

    // 基本的なタスク情報を取得して統計を計算
    try {
      const tasks: Task[] = await apiFetch('/tasks', {
        cacheTime: 60000, // 1分キャッシュ
      });

      const total = tasks.length;
      const byStatus: Record<Status, number> = {
        todo: 0,
        in_progress: 0,
        done: 0,
        blocked: 0,
        cancelled: 0,
      };
      const byCategory: Record<number, number> = {};

      for (const task of tasks) {
        // ステータス別カウント
        if (task.status in byStatus) {
          byStatus[task.status as Status]++;
        }

        // カテゴリ別カウント
        const categoryId = task.theme?.categoryId ?? 0;
        byCategory[categoryId] = (byCategory[categoryId] || 0) + 1;
      }

      return { total, byStatus, byCategory };
    } catch (fallbackError) {
      // フォールバックも失敗した場合はデフォルト値を返す
      console.error(
        'Failed to fetch tasks for statistics fallback:',
        fallbackError,
      );
      return {
        total: 0,
        byStatus: {
          todo: 0,
          in_progress: 0,
          done: 0,
          blocked: 0,
          cancelled: 0,
        },
        byCategory: {},
      };
    }
  }
}

/**
 * 最近のタスク取得（頻繁にアクセスされる）
 */
export async function fetchRecentTasks(limit: number = 10): Promise<Task[]> {
  return apiFetch(`/tasks/recent?limit=${limit}`, {
    cacheTime: 60000, // 1分キャッシュ
  });
}

/**
 * タスクの依存関係一括取得
 */
export async function fetchTaskDependencies(
  taskIds: number[],
): Promise<Record<number, number[]>> {
  if (taskIds.length === 0) return {};

  const requests = taskIds.reduce(
    (acc, taskId) => {
      acc[`task_${taskId}`] = {
        path: `/tasks/${taskId}/dependencies`,
        options: { cacheTime: 120000 }, // 2分キャッシュ
      };
      return acc;
    },
    {} as Record<string, { path: string; options?: RequestOptions }>,
  );

  const results =
    await parallelFetch<Record<string, number[] | { error: unknown }>>(
      requests,
    );

  // レスポンスを整形
  const dependencies: Record<number, number[]> = {};
  Object.entries(results).forEach(([key, value]) => {
    const taskId = parseInt(key.replace('task_', ''));
    if (!('error' in value)) {
      dependencies[taskId] = value as number[];
    } else {
      dependencies[taskId] = [];
    }
  });

  return dependencies;
}

/**
 * スマートプリフェッチ
 * ユーザーの操作パターンに基づいて次に必要になりそうなデータをプリフェッチ
 */
export async function smartPrefetchTasks(
  currentTaskId?: number,
  currentCategoryId?: number,
): Promise<void> {
  const prefetchPaths: string[] = [];

  if (currentTaskId) {
    // 現在のタスクの関連タスク
    prefetchPaths.push(`/tasks/${currentTaskId}/related`);
    prefetchPaths.push(`/tasks/${currentTaskId}/dependencies`);
  }

  if (currentCategoryId) {
    // 現在のカテゴリの次のページ
    prefetchPaths.push(`/tasks?categoryId=${currentCategoryId}&page=2`);
  }

  // 統計情報（ダッシュボードで使用）
  prefetchPaths.push('/tasks/statistics');

  await apiClient.prefetch(prefetchPaths, 120000); // 2分キャッシュ
}
