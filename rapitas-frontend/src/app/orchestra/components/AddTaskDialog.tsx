'use client';
// AddTaskDialog

import { Play } from 'lucide-react';
import type { AvailableTask } from '../types';

interface AddTaskDialogProps {
  /** Available tasks to select from */
  availableTasks: AvailableTask[];
  selectedTaskIds: number[];
  /** Whether the orchestra runner is currently active */
  isRunning: boolean;
  actionLoading: string | null;
  onSelectTask: (taskId: number, checked: boolean) => void;
  onCancel: () => void;
  /** Add to running session */
  onEnqueueSelected: () => void;
  /** Start a new session with selected tasks */
  onStartOrchestra: () => void;
  /** i18n helper */
  t: (key: string, values?: Record<string, unknown>) => string;
}

/**
 * Overlay dialog for selecting tasks to enqueue or start.
 *
 * @param availableTasks - List of eligible tasks for selection
 * @param selectedTaskIds - Currently checked task IDs
 * @param isRunning - Determines whether Add or Start button is shown
 * @param actionLoading - Disables actions when a request is in-flight
 * @param onSelectTask - Handler for checkbox toggles / チェックボックス変更ハンドラ
 * @param onCancel - Close without action
 * @param onEnqueueSelected - Add selected tasks to an active session
 * @param onStartOrchestra - Start a new session with selected tasks
 * @param t - Translation function / 翻訳関数
 */
export function AddTaskDialog({
  availableTasks,
  selectedTaskIds,
  isRunning,
  actionLoading,
  onSelectTask,
  onCancel,
  onEnqueueSelected,
  onStartOrchestra,
  t,
}: AddTaskDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[70vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('addTaskDialog.title')}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('addTaskDialog.description')}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {availableTasks.length === 0 ? (
            <p className="text-center text-gray-500 dark:text-gray-400 py-8">
              {t('addTaskDialog.noTasks')}
            </p>
          ) : (
            availableTasks.map((task) => (
              <label
                key={task.id}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                  selectedTaskIds.includes(task.id)
                    ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800 border border-transparent'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedTaskIds.includes(task.id)}
                  onChange={(e) => onSelectTask(task.id, e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    #{task.id} {task.title}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {task.theme && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {task.theme.name}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">
                      {task.priority} / {task.workflowStatus || 'draft'}
                    </span>
                  </div>
                </div>
              </label>
            ))
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {selectedTaskIds.length} {t('addTaskDialog.selected')}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              {t('cancel')}
            </button>
            {isRunning ? (
              <button
                onClick={onEnqueueSelected}
                disabled={selectedTaskIds.length === 0 || actionLoading !== null}
                className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                {t('addTaskDialog.add')}
              </button>
            ) : (
              <button
                onClick={onStartOrchestra}
                disabled={selectedTaskIds.length === 0 || actionLoading !== null}
                className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" />
                {t('addTaskDialog.startOrchestra')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
