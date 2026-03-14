/**
 * Task-specific API optimization functions
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
 * Bulk fetch tasks by category
 * Fetch tasks from multiple categories in parallel
 */
export async function fetchTasksByCategories(
  categoryIds: number[],
): Promise<Record<number, Task[]>> {
  if (categoryIds.length === 0) return {};

  const requests = categoryIds.reduce(
    (acc, categoryId) => {
      acc[`category_${categoryId}`] = {
        path: `/tasks?categoryId=${categoryId}`,
        options: { cacheTime: 30000 }, // 30 second cache
      };
      return acc;
    },
    {} as Record<string, { path: string; options?: RequestOptions }>,
  );

  const results =
    await parallelFetch<Record<string, Task[] | { error: unknown }>>(requests);

  // Format response
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
 * Bulk update task status
 * Update status of multiple tasks in a single request
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
 * Task search with debouncing
 * Handle search box input
 */
export async function searchTasks(query: string): Promise<Task[]> {
  if (!query.trim()) return [];

  return debouncedFetch<Task[]>(
    `/tasks/search?q=${encodeURIComponent(query)}`,
    { cacheTime: 60000 }, // 1 minute cache
    500, // 500ms debounce
  );
}

/**
 * Task preload
 * Preload tasks needed for next screen before navigation
 */
export async function preloadTaskDetails(taskIds: number[]): Promise<void> {
  const paths = taskIds.map((id) => `/tasks/${id}`);
  await apiClient.prefetch(paths, 300000); // 5 minute cache
}

/**
 * Fetch task statistics (cache-first)
 */
export async function fetchTaskStatistics(): Promise<{
  total: number;
  byStatus: Record<Status, number>;
  byCategory: Record<number, number>;
}> {
  try {
    return await apiFetch('/tasks/statistics', {
      cacheTime: 300000, // 5 minute cache
    });
  } catch (error) {
    // Fallback if endpoint not yet implemented
    console.warn(
      'Statistics endpoint not available, using fallback data:',
      error,
    );

    // Fetch basic task info and calculate statistics
    try {
      const tasks: Task[] = await apiFetch('/tasks', {
        cacheTime: 60000, // 1 minute cache
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
        // Count by status
        if (task.status in byStatus) {
          byStatus[task.status as Status]++;
        }

        // Count by category
        const categoryId = task.theme?.categoryId ?? 0;
        byCategory[categoryId] = (byCategory[categoryId] || 0) + 1;
      }

      return { total, byStatus, byCategory };
    } catch (fallbackError) {
      // Return default values if fallback also fails
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
 * Fetch recent tasks (frequently accessed)
 */
export async function fetchRecentTasks(limit: number = 10): Promise<Task[]> {
  return apiFetch(`/tasks/recent?limit=${limit}`, {
    cacheTime: 60000, // 1 minute cache
  });
}

/**
 * Bulk fetch task dependencies
 */
export async function fetchTaskDependencies(
  taskIds: number[],
): Promise<Record<number, number[]>> {
  if (taskIds.length === 0) return {};

  const requests = taskIds.reduce(
    (acc, taskId) => {
      acc[`task_${taskId}`] = {
        path: `/tasks/${taskId}/dependencies`,
        options: { cacheTime: 120000 }, // 2 minute cache
      };
      return acc;
    },
    {} as Record<string, { path: string; options?: RequestOptions }>,
  );

  const results =
    await parallelFetch<Record<string, number[] | { error: unknown }>>(
      requests,
    );

  // Format response
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
 * Smart prefetch
 * Prefetch data likely needed next based on user behavior patterns
 */
export async function smartPrefetchTasks(
  currentTaskId?: number,
  currentCategoryId?: number,
): Promise<void> {
  const prefetchPaths: string[] = [];

  if (currentTaskId) {
    // Related tasks of current task
    prefetchPaths.push(`/tasks/${currentTaskId}/related`);
    prefetchPaths.push(`/tasks/${currentTaskId}/dependencies`);
  }

  if (currentCategoryId) {
    // Next page of current category
    prefetchPaths.push(`/tasks?categoryId=${currentCategoryId}&page=2`);
  }

  // Statistics (used in dashboard)
  prefetchPaths.push('/tasks/statistics');

  await apiClient.prefetch(prefetchPaths, 120000); // 2 minute cache
}
