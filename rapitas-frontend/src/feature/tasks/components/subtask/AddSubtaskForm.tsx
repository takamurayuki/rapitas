/**
 * AddSubtaskForm
 *
 * Renders either the inline "add subtask" form when active, or the dashed
 * "add subtask" trigger button when inactive.
 * Stateless — all values and handlers are supplied via props.
 */
import { useTranslations } from 'next-intl';

interface AddSubtaskFormProps {
  isAddingSubtask: boolean;
  subtaskTitle: string;
  subtaskDescription: string;
  subtaskLabels: string;
  subtaskEstimatedHours: string;
  onSubtaskTitleChange: (value: string) => void;
  onSubtaskDescriptionChange: (value: string) => void;
  onSubtaskLabelsChange: (value: string) => void;
  onSubtaskEstimatedHoursChange: (value: string) => void;
  onAddSubtask: () => void;
  onCancelAddingSubtask: () => void;
  onStartAddingSubtask: () => void;
}

/**
 * Inline form for creating a new subtask, or a trigger button when collapsed.
 *
 * @param props - Form field values, change handlers, and submit/cancel callbacks.
 */
export default function AddSubtaskForm({
  isAddingSubtask,
  subtaskTitle,
  subtaskDescription,
  subtaskLabels,
  subtaskEstimatedHours,
  onSubtaskTitleChange,
  onSubtaskDescriptionChange,
  onSubtaskLabelsChange,
  onSubtaskEstimatedHoursChange,
  onAddSubtask,
  onCancelAddingSubtask,
  onStartAddingSubtask,
}: AddSubtaskFormProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');

  if (!isAddingSubtask) {
    return (
      <button
        type="button"
        onClick={onStartAddingSubtask}
        className="w-full rounded-lg border-2 border-dashed border-zinc-300 dark:border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
      >
        {t('addSubtask')}
      </button>
    );
  }

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-white dark:bg-indigo-dark-900 mb-4">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-3">
        {t('newSubtask')}
      </h3>
      <div className="space-y-3">
        <div>
          <input
            type="text"
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('subtaskTitleRequired')}
            value={subtaskTitle}
            onChange={(e) => onSubtaskTitleChange(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <textarea
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            placeholder={t('descriptionMarkdown')}
            value={subtaskDescription}
            onChange={(e) => onSubtaskDescriptionChange(e.target.value)}
            rows={3}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('labelsCommaSeparated')}
            value={subtaskLabels}
            onChange={(e) => onSubtaskLabelsChange(e.target.value)}
          />
          <input
            type="number"
            step="0.5"
            min="0"
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('estimatedHours')}
            value={subtaskEstimatedHours}
            onChange={(e) => onSubtaskEstimatedHoursChange(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onAddSubtask}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            disabled={!subtaskTitle.trim()}
          >
            {tc('add')}
          </button>
          <button
            type="button"
            onClick={onCancelAddingSubtask}
            className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            {tc('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
