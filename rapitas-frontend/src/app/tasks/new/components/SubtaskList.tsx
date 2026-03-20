/**
 * SubtaskList
 *
 * Displays the list of pending subtasks that have been added but not yet saved.
 * Renders status icon, title, priority badge, estimated hours, and a remove button.
 */
'use client';
import { Clock, Trash2 } from 'lucide-react';
import type { PendingSubtask } from '../hooks/useNewTaskForm';
import type { PriorityOption } from './PrioritySelector';
import { statusConfig, renderStatusIcon } from '@/feature/tasks/config/StatusConfig';

interface SubtaskListProps {
  subtasks: PendingSubtask[];
  priorityOptions: PriorityOption[];
  /** Called with the subtask's temporary ID when the user clicks Remove. */
  onRemove: (id: string) => void;
}

/**
 * Renders the ordered list of pending subtasks with remove controls.
 *
 * @param props.subtasks - Pending subtask array / 追加済みサブタスクリスト
 * @param props.priorityOptions - Priority descriptors used for badge rendering / 優先度バッジ用オプション
 * @param props.onRemove - Remove handler / 削除ハンドラ
 */
export function SubtaskList({ subtasks, priorityOptions, onRemove }: SubtaskListProps) {
  if (subtasks.length === 0) return null;

  return (
    <div className="bg-zinc-50/50 dark:bg-indigo-dark-900/50 rounded-lg overflow-hidden">
      {subtasks.map((st, index) => {
        // NOTE: New subtasks always display with 'todo' status styling.
        const subtaskStatus = statusConfig.todo;
        const isFirst = index === 0;
        const isLast = index === subtasks.length - 1;
        const roundedClass =
          isFirst && isLast
            ? 'rounded-md'
            : isFirst
              ? 'rounded-t-md'
              : isLast
                ? 'rounded-b-md'
                : '';

        return (
          <div
            key={st.id}
            className={`group p-2 ${roundedClass} transition-colors border-l-2 ${subtaskStatus.borderColor} ${subtaskStatus.bgColor} dark:bg-indigo-dark-900`}
          >
            <div className="flex items-center gap-2">
              <div
                className={`flex items-center justify-center w-6 h-6 rounded ${subtaskStatus.color} ${subtaskStatus.bgColor} border ${subtaskStatus.borderColor.replace('border-l-', 'border-')} shrink-0`}
                aria-label={subtaskStatus.label}
              >
                {renderStatusIcon('todo')}
              </div>

              <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300">
                {st.title}
              </span>

              {/* Priority badge — only shown for non-medium priorities */}
              {st.priority &&
                st.priority !== 'medium' &&
                (() => {
                  const opt = priorityOptions.find((o) => o.value === st.priority);
                  return opt ? (
                    <span
                      className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium text-white ${opt.bgColor}`}
                    >
                      <span className="text-white">{opt.icon}</span>
                      {opt.label}
                    </span>
                  ) : null;
                })()}

              {st.estimatedHours && (
                <span className="flex items-center gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <Clock className="w-3 h-3" />
                  {st.estimatedHours}h
                </span>
              )}

              <button
                type="button"
                onClick={() => onRemove(st.id)}
                className="p-1 text-zinc-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {(st.description || (st.labels && st.labels.length > 0)) && (
              <div className="ml-8 mt-1 space-y-1">
                {st.description && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                    {st.description}
                  </p>
                )}
                {st.labels && st.labels.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {st.labels.map((label) => (
                      <span
                        key={label}
                        className="px-1.5 py-0.5 text-xs rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
