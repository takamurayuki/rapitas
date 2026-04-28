/**
 * SubtaskItem
 *
 * Renders a single subtask row in either view mode or inline-edit mode.
 * Handles both active and completed visual variants via the `isCompleted` prop.
 * No local state — all edit state is lifted to SubtaskList.
 */
import { useTranslations } from 'next-intl';
import { type Task } from '@/types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { getLabelsArray, hasLabels } from '@/utils/labels';
import TaskStatusChange from '@/feature/tasks/components/TaskStatusChange';
import PriorityIcon from '@/feature/tasks/components/PriorityIcon';
import { statusConfig, renderStatusIcon } from '@/feature/tasks/config/StatusConfig';
import { Pencil, Check, X, Bot, CheckSquare, Square } from 'lucide-react';
import { SubtaskTitleIndicator, type ParallelExecutionStatus } from '../SubtaskExecutionStatus';

interface SubtaskItemProps {
  subtask: Task;
  isCompleted: boolean;
  isSelectionMode: boolean;
  isSelected: boolean;
  isEditing: boolean;
  editingTitle: string;
  editingDescription: string;
  isParallelExecutionRunning: boolean;
  executionStatus: ParallelExecutionStatus | undefined;
  onToggleSelect: (subtaskId: number) => void;
  onStatusUpdate: (taskId: number, newStatus: string) => void;
  onDeleteSubtask: (subtaskId: number) => void;
  onStartEditing: (subtask: Task) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditingTitleChange: (value: string) => void;
  onEditingDescriptionChange: (value: string) => void;
  canEdit: boolean;
}

/** SVG trash icon shared between active and completed rows. */
function TrashIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}

/**
 * Single subtask card supporting view, inline-edit, and selection modes.
 *
 * @param props - Subtask data, edit/selection state, and event handlers.
 */
export default function SubtaskItem({
  subtask,
  isCompleted,
  isSelectionMode,
  isSelected,
  isEditing,
  editingTitle,
  editingDescription,
  isParallelExecutionRunning,
  executionStatus,
  onToggleSelect,
  onStatusUpdate,
  onDeleteSubtask,
  onStartEditing,
  onSaveEdit,
  onCancelEdit,
  onEditingTitleChange,
  onEditingDescriptionChange,
  canEdit,
}: SubtaskItemProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');

  const selectionBorder =
    isSelectionMode && isSelected
      ? 'border-blue-500 dark:border-blue-400 ring-1 ring-blue-500 dark:ring-blue-400'
      : 'border-zinc-200 dark:border-zinc-700';

  if (isCompleted) {
    return (
      <div
        className={`rounded-lg border bg-zinc-50 dark:bg-indigo-dark-800 p-3 ${
          isSelectionMode && isSelected
            ? `${selectionBorder} opacity-100`
            : `${selectionBorder} opacity-60`
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1">
            {isSelectionMode && (
              <button onClick={() => onToggleSelect(subtask.id)} className="shrink-0">
                {isSelected ? (
                  <CheckSquare className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                ) : (
                  <Square className="w-5 h-5 text-zinc-400" />
                )}
              </button>
            )}
            {isParallelExecutionRunning && (
              <SubtaskTitleIndicator executionStatus={executionStatus} size="sm" />
            )}
            <h4 className="text-base font-medium text-zinc-900 dark:text-zinc-50 line-through">
              {subtask.title}
            </h4>
            <PriorityIcon priority={subtask.priority} size="sm" />
            {subtask.agentGenerated && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded">
                <Bot className="w-3 h-3" />
                AI
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 ml-4">
            {(['todo', 'in-progress', 'done'] as const).map((status) => {
              const config = statusConfig[status];
              return (
                <TaskStatusChange
                  key={status}
                  status={status}
                  currentStatus={subtask.status}
                  config={config}
                  renderIcon={renderStatusIcon}
                  onClick={(newStatus) => onStatusUpdate(subtask.id, newStatus)}
                  size="sm"
                />
              );
            })}
            {canEdit && (
              <button
                onClick={() => onStartEditing(subtask)}
                className="w-6 h-6 rounded flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                title={tc('edit')}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => onDeleteSubtask(subtask.id)}
              className="w-6 h-6 rounded flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
              title={tc('delete')}
            >
              <TrashIcon />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active subtask card
  return (
    <div className={`rounded-lg border bg-zinc-50 dark:bg-indigo-dark-800 p-4 ${selectionBorder}`}>
      {isSelectionMode && (
        <div className="flex items-center mb-3">
          <button
            onClick={() => onToggleSelect(subtask.id)}
            className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            {isSelected ? (
              <CheckSquare className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            ) : (
              <Square className="w-5 h-5" />
            )}
            <span>{t('select')}</span>
          </button>
        </div>
      )}

      {isEditing ? (
        <div className="space-y-3">
          <input
            type="text"
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={editingTitle}
            onChange={(e) => onEditingTitleChange(e.target.value)}
            placeholder={t('subtaskTitle')}
            autoFocus
          />
          <textarea
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            value={editingDescription}
            onChange={(e) => onEditingDescriptionChange(e.target.value)}
            placeholder={t('descriptionMarkdown')}
            rows={3}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={onSaveEdit}
              disabled={!editingTitle.trim()}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              {tc('save')}
            </button>
            <button
              onClick={onCancelEdit}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
              {tc('cancel')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                {isParallelExecutionRunning && (
                  <SubtaskTitleIndicator executionStatus={executionStatus} size="md" />
                )}
                <h4 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
                  {subtask.title}
                </h4>
                <PriorityIcon priority={subtask.priority} size="md" />
                {subtask.agentGenerated && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded">
                    <Bot className="w-3 h-3" />
                    AI
                  </span>
                )}
              </div>
              {subtask.description && (
                <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none mt-2">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                    {subtask.description}
                  </ReactMarkdown>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 ml-4 shrink-0">
              {(['todo', 'in-progress', 'done'] as const).map((status) => {
                const config = statusConfig[status];
                return (
                  <TaskStatusChange
                    key={status}
                    status={status}
                    currentStatus={subtask.status}
                    config={config}
                    renderIcon={renderStatusIcon}
                    onClick={(newStatus) => onStatusUpdate(subtask.id, newStatus)}
                    size="sm"
                  />
                );
              })}
              {canEdit && (
                <button
                  onClick={() => onStartEditing(subtask)}
                  className="w-6 h-6 rounded flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                  title={tc('edit')}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => onDeleteSubtask(subtask.id)}
                className="w-6 h-6 rounded flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                title={tc('delete')}
              >
                <TrashIcon />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasLabels(subtask.labels) && (
              <div className="flex gap-1">
                {getLabelsArray(subtask.labels).map((label, idx) => (
                  <span
                    key={idx}
                    className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}
            {subtask.estimatedHours && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                ⏱ {subtask.estimatedHours}h
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
