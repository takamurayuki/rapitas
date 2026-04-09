/**
 * DependencyPicker - タスク依存関係の管理 UI
 *
 * タスク詳細画面で依存関係を追加・削除するコンポーネント
 */

import React, { useState } from 'react';
import { Plus, X, Clock, ArrowRight, Loader2 } from 'lucide-react';
import { useDependencies } from './useDependencies';
import { TaskSelector } from '../task-selector/TaskSelector';
import type { Task } from '@/types/task.types';

interface DependencyPickerProps {
  taskId: number;
}

export function DependencyPicker({ taskId }: DependencyPickerProps) {
  const { dependencies, isLoading, addDependency, removeDependency } = useDependencies(taskId);
  const [showAddDependency, setShowAddDependency] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isRemoving, setIsRemoving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAddDependency = async (selectedTask: Task) => {
    setIsAdding(true);
    setError(null);

    try {
      await addDependency(selectedTask.id);
      setShowAddDependency(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '依存関係の追加に失敗しました');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveDependency = async (dependencyId: number) => {
    setIsRemoving(dependencyId);
    setError(null);

    try {
      await removeDependency(dependencyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '依存関係の削除に失敗しました');
    } finally {
      setIsRemoving(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
        <span className="ml-2 text-gray-500">依存関係を読み込み中...</span>
      </div>
    );
  }

  if (!dependencies) {
    return null;
  }

  const blockedByTasks = dependencies.blockedBy.filter(dep => dep.fromTask.status !== 'completed');
  const blockingTasks = dependencies.blocking;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          タスク依存関係
        </h3>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* このタスクをブロックしているタスク */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center">
            <Clock className="h-4 w-4 mr-2 text-orange-500" />
            このタスクをブロックしているタスク
          </h4>
          <button
            onClick={() => setShowAddDependency(true)}
            disabled={isAdding}
            className="inline-flex items-center px-2 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAdding ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Plus className="h-3 w-3 mr-1" />
            )}
            依存追加
          </button>
        </div>

        {blockedByTasks.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-2 border rounded-lg border-dashed border-gray-300 dark:border-gray-600 text-center">
            ブロッカーはありません
          </p>
        ) : (
          <div className="space-y-2">
            {blockedByTasks.map((dependency) => (
              <div
                key={dependency.id}
                className="flex items-center justify-between p-3 bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-orange-900 dark:text-orange-100 truncate">
                    {dependency.fromTask.title}
                  </p>
                  <p className="text-xs text-orange-700 dark:text-orange-400">
                    ステータス: {dependency.fromTask.status} • {dependency.type} • {dependency.lagDays}日遅延
                  </p>
                </div>
                <button
                  onClick={() => handleRemoveDependency(dependency.id)}
                  disabled={isRemoving === dependency.id}
                  className="ml-2 p-1 text-orange-600 hover:text-orange-800 dark:text-orange-400 dark:hover:text-orange-200 disabled:opacity-50"
                  title="依存関係を削除"
                >
                  {isRemoving === dependency.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* このタスクがブロックしているタスク */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center">
          <ArrowRight className="h-4 w-4 mr-2 text-blue-500" />
          このタスクがブロックしているタスク
        </h4>

        {blockingTasks.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-2 border rounded-lg border-dashed border-gray-300 dark:border-gray-600 text-center">
            ブロック中のタスクはありません
          </p>
        ) : (
          <div className="space-y-2">
            {blockingTasks.map((dependency) => (
              <div
                key={dependency.id}
                className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-100 truncate">
                    {dependency.toTask.title}
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-400">
                    ステータス: {dependency.toTask.status} • {dependency.type} • {dependency.lagDays}日遅延
                  </p>
                </div>
                <button
                  onClick={() => handleRemoveDependency(dependency.id)}
                  disabled={isRemoving === dependency.id}
                  className="ml-2 p-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 disabled:opacity-50"
                  title="依存関係を削除"
                >
                  {isRemoving === dependency.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* タスク選択ダイアログ */}
      {showAddDependency && (
        <TaskSelector
          isOpen={showAddDependency}
          onClose={() => setShowAddDependency(false)}
          onSelect={handleAddDependency}
          excludeTaskIds={[taskId]} // 自分自身は除外
          title="依存するタスクを選択"
          description="このタスクの前に完了する必要があるタスクを選択してください"
        />
      )}
    </div>
  );
}