import { useTranslations } from 'next-intl';
import { type Task } from '@/types';
import TaskDescription from '@/feature/tasks/components/text/TaskDescription';
import TaskStatusChange from '@/feature/tasks/components/status/TaskStatusChange';
import { getStatusDisplay, renderStatusIcon } from '@/feature/tasks/config/StatusConfig';
import { getLabelsArray, hasLabels } from '@/utils/labels';
import { Tag } from 'lucide-react';
import { getIconComponent } from '@/components/category/icon-data';
import { useLocaleStore } from '@/stores/locale-store';
import { formatDateTime } from '@/lib/utils';
import DurationInput from '@/components/ui/hours-minutes-input/HoursMinutesInput';

interface TaskDetailProps {
  task: Task;
  isEditing: boolean;
  editTitle: string;
  editDescription: string;
  editStatus: string;
  editLabels: string;
  editEstimatedHours: string;
  isDragging: boolean;
  onEditTitleChange: (value: string) => void;
  onEditDescriptionChange: (value: string) => void;
  onEditStatusChange: (value: string) => void;
  onEditLabelsChange: (value: string) => void;
  onEditEstimatedHoursChange: (value: string) => void;
  onStatusUpdate: (taskId: number, newStatus: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLTextAreaElement>) => void;
}

export default function TaskDetail({
  task,
  isEditing,
  editTitle,
  editDescription,
  editStatus,
  editLabels,
  editEstimatedHours,
  onEditTitleChange,
  onEditDescriptionChange,
  onEditStatusChange,
  onEditLabelsChange,
  onEditEstimatedHoursChange,
  onStatusUpdate,
  onDragOver,
  onDragLeave,
  onDrop,
}: TaskDetailProps) {
  const t = useTranslations('task');
  const locale = useLocaleStore((s) => s.locale);
  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800 p-8 mb-6">
      {isEditing ? (
        /* Edit mode */
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
              {t('taskDetail.titleLabel')} <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <input
                type="text"
                className="flex-1 min-w-0 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-4 py-3 text-lg font-bold shadow-sm focus:outline-none focus:border-indigo-400"
                value={editTitle}
                onChange={(e) => onEditTitleChange(e.target.value)}
                aria-label={t('taskDetail.titleLabel')}
                required
              />
              <div className="flex items-center gap-1 shrink-0">
                {(['todo', 'in-progress', 'done'] as const).map((status) => {
                  const config = getStatusDisplay(t, status);
                  return (
                    <TaskStatusChange
                      key={status}
                      status={status}
                      currentStatus={editStatus}
                      config={config}
                      renderIcon={renderStatusIcon}
                      onClick={(newStatus) => onEditStatusChange(newStatus)}
                      size="md"
                    />
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
              {t('description')}
            </label>
            <textarea
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-4 py-3 shadow-sm focus:outline-none focus:border-indigo-400 font-mono text-sm"
              rows={14}
              value={editDescription}
              onChange={(e) => onEditDescriptionChange(e.target.value)}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              placeholder={t('taskDetail.descriptionPlaceholder')}
              aria-label={t('description')}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                {t('labels')}
              </label>
              <input
                type="text"
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-4 py-3 shadow-sm focus:outline-none focus:border-indigo-400"
                placeholder={t('taskDetail.labelsPlaceholder')}
                value={editLabels}
                onChange={(e) => onEditLabelsChange(e.target.value)}
                aria-label={t('labels')}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                {t('estimatedTime')}
              </label>
              <DurationInput
                value={editEstimatedHours}
                onChange={onEditEstimatedHoursChange}
                aria-label={t('estimatedTime')}
              />
            </div>
          </div>
        </div>
      ) : (
        /* View mode */
        <>
          <div className="flex items-start justify-between mb-4">
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">{task.title}</h1>
            <div className="flex items-center gap-2">
              {(['todo', 'in-progress', 'done'] as const).map((status) => {
                const config = getStatusDisplay(t, status);
                return (
                  <TaskStatusChange
                    key={status}
                    status={status}
                    currentStatus={task.status}
                    config={config}
                    renderIcon={renderStatusIcon}
                    onClick={(newStatus) => onStatusUpdate(task.id, newStatus)}
                    size="md"
                  />
                );
              })}
            </div>
          </div>

          {task.description && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                {t('description')}
              </h2>
              <TaskDescription description={task.description} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 mb-6">
            {task.taskLabels && task.taskLabels.length > 0 ? (
              <div>
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                  {t('labels')}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {task.taskLabels.map((tl) => {
                    if (!tl.label) return null;
                    const IconComponent = getIconComponent(tl.label.icon || '') || Tag;
                    return (
                      <span
                        key={tl.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium"
                        style={{
                          backgroundColor: `${tl.label.color}20`,
                          color: tl.label.color,
                        }}
                      >
                        <IconComponent className="w-3.5 h-3.5" />
                        {tl.label.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : hasLabels(task.labels) ? (
              <div>
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                  {t('labels')}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {getLabelsArray(task.labels).map((label, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 text-sm"
                    >
                      <Tag className="w-3.5 h-3.5" />
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {task.estimatedHours && (
              <div>
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                  {t('estimatedTime')}
                </h3>
                <span className="px-3 py-1 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 text-sm inline-block">
                  {t('taskDetail.estimatedHoursBadge', { hours: task.estimatedHours })}
                </span>
              </div>
            )}
          </div>

          <div className="text-sm text-zinc-500 dark:text-zinc-400 border-t border-zinc-200 dark:border-zinc-700 pt-4">
            <p>
              {t('createdAt')}: {formatDateTime(task.createdAt, locale)}
            </p>
            <p>
              {t('updatedAt')}: {formatDateTime(task.updatedAt, locale)}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
