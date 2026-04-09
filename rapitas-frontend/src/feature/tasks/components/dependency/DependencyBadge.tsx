/**
 * DependencyBadge - タスクカード用の依存関係バッジ
 *
 * タスクの依存関係の状態を視覚的に表示するコンポーネント
 */

import React from 'react';
import { useDependencies } from './useDependencies';
import { Clock, ArrowRight } from 'lucide-react';

interface DependencyBadgeProps {
  taskId: number;
  compact?: boolean;
}

export function DependencyBadge({ taskId, compact = false }: DependencyBadgeProps) {
  const { dependencies, isLoading } = useDependencies(taskId);

  if (isLoading || !dependencies) {
    return null;
  }

  const blockedByCount = dependencies.blockedBy.length;
  const blockingCount = dependencies.blocking.length;

  if (blockedByCount === 0 && blockingCount === 0) {
    return null;
  }

  if (compact) {
    // コンパクトモード（タスクカード用）
    return (
      <div className="flex items-center space-x-1">
        {blockedByCount > 0 && (
          <div className="flex items-center space-x-1 px-2 py-1 bg-orange-100 dark:bg-orange-800 text-orange-700 dark:text-orange-300 text-xs rounded-md">
            <Clock className="h-3 w-3" />
            <span>{blockedByCount}件待ち</span>
          </div>
        )}
        {blockingCount > 0 && (
          <div className="flex items-center space-x-1 px-2 py-1 bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-300 text-xs rounded-md">
            <ArrowRight className="h-3 w-3" />
            <span>{blockingCount}件影響</span>
          </div>
        )}
      </div>
    );
  }

  // 詳細モード
  const blockedByTasks = dependencies.blockedBy.filter(dep => dep.fromTask.status !== 'completed');
  const completedBlockers = dependencies.blockedBy.length - blockedByTasks.length;

  return (
    <div className="space-y-2">
      {blockedByTasks.length > 0 && (
        <div className="flex items-start space-x-2 p-2 bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-lg">
          <Clock className="h-4 w-4 text-orange-600 dark:text-orange-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-orange-800 dark:text-orange-300 font-medium">
              ⏸ 以下のタスク完了待ち:
            </p>
            <ul className="mt-1 space-y-1">
              {blockedByTasks.map((dep) => (
                <li key={dep.id} className="text-sm text-orange-700 dark:text-orange-400 truncate">
                  • {dep.fromTask.title}
                </li>
              ))}
            </ul>
            {completedBlockers > 0 && (
              <p className="text-xs text-orange-600 dark:text-orange-500 mt-1">
                ({completedBlockers}件は既に完了済み)
              </p>
            )}
          </div>
        </div>
      )}

      {blockingCount > 0 && (
        <div className="flex items-start space-x-2 p-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
          <ArrowRight className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-blue-800 dark:text-blue-300 font-medium">
              このタスク完了で {blockingCount} 件のタスクがブロック解除されます
            </p>
          </div>
        </div>
      )}
    </div>
  );
}