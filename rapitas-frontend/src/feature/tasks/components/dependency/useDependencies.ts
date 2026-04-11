/**
 * useDependencies - タスク依存関係の管理 hook
 *
 * SWR を使用してタスクの依存関係を取得・操作する
 */

import useSWR from 'swr';
import type { TaskDependencies, TaskDependencyInfo } from '@/types/task.types';

const API_BASE =
  process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : '';

interface UseDependenciesReturn {
  dependencies: TaskDependencies | undefined;
  isLoading: boolean;
  error: any;
  addDependency: (
    blockedById: number,
    type?: string,
    lagDays?: number,
  ) => Promise<TaskDependencyInfo>;
  removeDependency: (dependencyId: number) => Promise<void>;
  mutate: () => void;
}

/**
 * 指定タスクの依存関係を管理するフック
 */
export function useDependencies(taskId: number): UseDependenciesReturn {
  const {
    data: dependencies,
    error,
    isLoading,
    mutate,
  } = useSWR<TaskDependencies>(
    taskId ? `/tasks/${taskId}/dependencies` : null,
    async (url: string) => {
      const response = await fetch(`${API_BASE}${url}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch dependencies: ${response.statusText}`);
      }
      return response.json();
    },
  );

  const addDependency = async (
    blockedById: number,
    type: string = 'FS',
    lagDays: number = 0,
  ): Promise<TaskDependencyInfo> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/dependencies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        blockedById,
        type,
        lagDays,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `Failed to add dependency: ${response.statusText}`,
      );
    }

    const newDependency = await response.json();

    // キャッシュを更新
    mutate();

    return newDependency;
  };

  const removeDependency = async (dependencyId: number): Promise<void> => {
    const response = await fetch(
      `${API_BASE}/tasks/${taskId}/dependencies/${dependencyId}`,
      {
        method: 'DELETE',
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message ||
          `Failed to remove dependency: ${response.statusText}`,
      );
    }

    // キャッシュを更新
    mutate();
  };

  return {
    dependencies,
    isLoading,
    error,
    addDependency,
    removeDependency,
    mutate,
  };
}
