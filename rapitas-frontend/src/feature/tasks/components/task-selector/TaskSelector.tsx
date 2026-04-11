/**
 * TaskSelector - タスク選択ダイアログ
 *
 * 既存タスクから選択するためのモーダルダイアログ
 */

import React, { useState, useEffect } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import type { Task } from '@/types/task.types';

interface TaskSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (task: Task) => void;
  excludeTaskIds?: number[];
  title?: string;
  description?: string;
}

const API_BASE =
  process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : '';

export function TaskSelector({
  isOpen,
  onClose,
  onSelect,
  excludeTaskIds = [],
  title = 'タスクを選択',
  description = '選択したいタスクをクリックしてください',
}: TaskSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = async (query: string = '') => {
    setIsLoading(true);
    setError(null);

    try {
      const searchParams = new URLSearchParams();
      if (query) {
        searchParams.append('search', query);
      }
      searchParams.append('limit', '50');
      searchParams.append('status', 'todo');
      searchParams.append('status', 'in_progress');
      searchParams.append('status', 'completed');

      const response = await fetch(
        `${API_BASE}/tasks?${searchParams.toString()}`,
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch tasks: ${response.statusText}`);
      }

      const data = await response.json();
      const filteredTasks =
        data.tasks?.filter((task: Task) => !excludeTaskIds.includes(task.id)) ||
        [];
      setTasks(filteredTasks);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'タスクの取得に失敗しました',
      );
      setTasks([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchTasks();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const timeoutId = setTimeout(() => {
        fetchTasks(searchQuery);
      }, 300);

      return () => clearTimeout(timeoutId);
    }
  }, [searchQuery, isOpen]);

  const handleSelect = (task: Task) => {
    onSelect(task);
    onClose();
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      todo: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
      in_progress:
        'bg-blue-100 text-blue-700 dark:bg-blue-800 dark:text-blue-300',
      completed:
        'bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-300',
      blocked:
        'bg-orange-100 text-orange-700 dark:bg-orange-800 dark:text-orange-300',
    };

    const labels = {
      todo: 'Todo',
      in_progress: 'In Progress',
      completed: 'Completed',
      blocked: 'Blocked',
    };

    return (
      <span
        className={`px-2 py-1 text-xs rounded-full ${colors[status as keyof typeof colors] || colors.todo}`}
      >
        {labels[status as keyof typeof labels] || status}
      </span>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {title}
            </h2>
            {description && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {description}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 flex-1 min-h-0">
          {/* 検索バー */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="タスクを検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>

          {/* タスク一覧 */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
                <span className="ml-2 text-gray-500">タスクを検索中...</span>
              </div>
            ) : error ? (
              <div className="text-center py-8">
                <p className="text-red-600 dark:text-red-400">{error}</p>
              </div>
            ) : tasks.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 dark:text-gray-400">
                  {searchQuery
                    ? '検索結果が見つかりません'
                    : '利用可能なタスクがありません'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => handleSelect(task)}
                    className="w-full text-left p-3 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {task.title}
                        </p>
                        {task.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-1">
                            {task.description}
                          </p>
                        )}
                        <div className="flex items-center mt-2 space-x-2">
                          {getStatusBadge(task.status)}
                          {task.theme && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {task.theme.name}
                            </span>
                          )}
                          {task.dueDate && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              期限:{' '}
                              {new Date(task.dueDate).toLocaleDateString(
                                'ja-JP',
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* フッター */}
        <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-600">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
