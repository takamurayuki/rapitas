'use client';
// KanbanCard

import { ExternalLink } from 'lucide-react';
import type {
  DraggableProvided,
  DraggableStateSnapshot,
} from '@hello-pangea/dnd';
import { getLabelsArray, hasLabels } from '@/utils/labels';

interface KanbanCardTask {
  id: number;
  title: string;
  createdAt: string;
  estimatedHours?: number | null;
  labels?: unknown;
  subtasks?: Array<{ status: string }> | null;
}

interface ExecutionClasses {
  cardClass: string;
  badgeClass: string;
  dotClass: string;
  label: string;
}

interface KanbanCardProps {
  task: KanbanCardTask;
  provided: DraggableProvided;
  snapshot: DraggableStateSnapshot;
  executionClasses: ExecutionClasses | null;
  dateLocale: string;
  onOpen: (taskId: number) => void;
  onOpenInPage: (taskId: number) => void;
  /** i18n helper for kanban namespace */
  t: (key: string, values?: Record<string, unknown>) => string;
}

/**
 * Renders a single Kanban task card with drag handle support.
 *
 * @param task - Task data to display
 * @param provided - DraggableProvided from @hello-pangea/dnd
 * @param snapshot - DraggableStateSnapshot for drag styling
 * @param executionClasses - Optional execution-state styling/label
 * @param dateLocale - Locale string for date formatting
 * @param onOpen - Open task in slide panel
 * @param onOpenInPage - Navigate to full task page
 * @param t - kanban translation function
 */
export function KanbanCard({
  task,
  provided,
  snapshot,
  executionClasses,
  dateLocale,
  onOpen,
  onOpenInPage,
  t,
}: KanbanCardProps) {
  return (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      onClick={() => onOpen(task.id)}
      className={`rounded-lg border bg-white dark:bg-zinc-800 p-3 shadow-sm transition-all cursor-pointer ${
        snapshot.isDragging
          ? 'shadow-lg border-blue-500'
          : 'border-zinc-200 dark:border-zinc-700 hover:shadow-md hover:border-blue-400 dark:hover:border-blue-600'
      } ${executionClasses?.cardClass || ''}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {task.title}
        </h3>
        <div className="flex items-center gap-2">
          {/* Execution state badge */}
          {executionClasses && (
            <div
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${executionClasses.badgeClass}`}
              title={t('taskStatus', { status: executionClasses.label })}
            >
              <div
                className={`w-1.5 h-1.5 rounded-full execution-dot-pulse ${executionClasses.dotClass}`}
              />
              <span>{executionClasses.label}</span>
            </div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenInPage(task.id);
            }}
            className="text-zinc-500 hover:text-blue-600 dark:text-zinc-400 dark:hover:text-blue-400 transition-colors"
            title={t('openInPage')}
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Meta information */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        {/* Date */}
        <span className="flex items-center gap-1">
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          {new Date(task.createdAt).toLocaleDateString(dateLocale)}
        </span>

        {/* Subtasks */}
        {task.subtasks && task.subtasks.length > 0 && (
          <span className="flex items-center gap-1">
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
            {task.subtasks.filter((st) => st.status === 'done').length}/
            {task.subtasks.length}
          </span>
        )}

        {/* Label count */}
        {hasLabels(task.labels) && (
          <span className="flex items-center gap-1">
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
              />
            </svg>
            {getLabelsArray(task.labels).length}
          </span>
        )}

        {/* Estimated hours */}
        {task.estimatedHours && (
          <span className="flex items-center gap-1">
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {task.estimatedHours}h
          </span>
        )}
      </div>

      {/* Label display */}
      {hasLabels(task.labels) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {getLabelsArray(task.labels)
            .slice(0, 3)
            .map((label, idx) => (
              <span
                key={idx}
                className="rounded-full bg-blue-100 dark:bg-blue-900 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300"
              >
                {label}
              </span>
            ))}
          {getLabelsArray(task.labels).length > 3 && (
            <span className="text-xs text-zinc-500">
              +{getLabelsArray(task.labels).length - 3}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
