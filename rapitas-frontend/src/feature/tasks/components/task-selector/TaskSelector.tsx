/**
 * TaskSelector - タスク選択ダイアログ
 *
 * 既存タスクから選択するためのモーダルダイアログ
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Task } from '@/types/task.types';
import { useFocusTrap } from '@/hooks/common/useFocusTrap';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';

interface TaskSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (task: Task) => void;
  excludeTaskIds?: number[];
  title?: string;
  description?: string;
}

const API_BASE = process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:3001' : '';

// NOTE: stable reference for the `excludeTaskIds` default — an inline `= []`
// default creates a new array every render, which would defeat memoizing
// `fetchTasks` below and re-trigger the fetch effects on every render.
const EMPTY_TASK_IDS: number[] = [];

export function TaskSelector({
  isOpen,
  onClose,
  onSelect,
  excludeTaskIds = EMPTY_TASK_IDS,
  title,
  description,
}: TaskSelectorProps) {
  const t = useTranslations('task.taskSelector');
  const tc = useTranslations('common');
  const locale = useLocaleStore((s) => s.locale);
  const focusTrapRef = useFocusTrap<HTMLDivElement>(isOpen);
  const [searchQuery, setSearchQuery] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolvedTitle = title ?? t('defaultTitle');
  const resolvedDescription = description ?? t('defaultDescription');

  const fetchTasks = useCallback(
    async (query: string = '') => {
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

        const response = await fetch(`${API_BASE}/tasks?${searchParams.toString()}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch tasks: ${response.statusText}`);
        }

        const data = await response.json();
        // NOTE: GET /tasks returns a flat array, not { tasks: [...] }.
        const taskList = Array.isArray(data) ? data : (data.tasks ?? []);
        const filteredTasks = taskList.filter((task: Task) => !excludeTaskIds.includes(task.id));
        setTasks(filteredTasks);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('fetchFailed'));
        setTasks([]);
      } finally {
        setIsLoading(false);
      }
    },
    [excludeTaskIds, t],
  );

  useEffect(() => {
    if (isOpen) {
      fetchTasks();
    }
  }, [isOpen, fetchTasks]);

  useEffect(() => {
    if (isOpen) {
      const timeoutId = setTimeout(() => {
        fetchTasks(searchQuery);
      }, 300);

      return () => clearTimeout(timeoutId);
    }
  }, [searchQuery, isOpen, fetchTasks]);

  const handleSelect = (task: Task) => {
    onSelect(task);
    onClose();
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      todo: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
      in_progress: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-800 dark:text-indigo-300',
      completed: 'bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-300',
      blocked: 'bg-orange-100 text-orange-700 dark:bg-orange-800 dark:text-orange-300',
    };

    // NOTE: Status labels shown here are English by design (matches upstream
    // status codes), not translated.
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-selector-title"
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2
              id="task-selector-title"
              className="text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              {resolvedTitle}
            </h2>
            {resolvedDescription && (
              <p className="text-sm text-gray-600 dark:text-gray-400">{resolvedDescription}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={tc('close')}
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
              placeholder={t('searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:border-indigo-400 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>

          {/* タスク一覧 */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner size="md" className="text-gray-500 dark:text-gray-500" />
                <span className="ml-2 text-gray-500">{t('searching')}</span>
              </div>
            ) : error ? (
              <div className="text-center py-8">
                <p className="text-red-600 dark:text-red-400">{error}</p>
              </div>
            ) : tasks.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 dark:text-gray-400">
                  {searchQuery ? t('noResults') : t('empty')}
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
                              {t('dueDate', {
                                date: new Date(task.dueDate).toLocaleDateString(
                                  toDateLocale(locale),
                                ),
                              })}
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
            {tc('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
