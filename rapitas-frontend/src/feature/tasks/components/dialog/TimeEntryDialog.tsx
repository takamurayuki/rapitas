import { useTranslations } from 'next-intl';

interface TimeEntryDialogProps {
  show: boolean;
  note: string;
  onNoteChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export default function TimeEntryDialog({
  show,
  note,
  onNoteChange,
  onSave,
  onCancel,
}: TimeEntryDialogProps) {
  const t = useTranslations('task');
  const tCommon = useTranslations('common');
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-indigo-dark-900 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-800 w-full max-w-md p-6">
        <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 mb-4">
          {t('timeEntryDialog.heading')}
        </h3>
        <div className="mb-4">
          <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
            {t('timeEntryDialog.noteLabel')}
          </label>
          <textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-4 py-3 text-sm shadow-sm focus:outline-none focus:border-indigo-400"
            rows={3}
            placeholder={t('timeEntryDialog.notePlaceholder')}
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-300 dark:hover:bg-zinc-600 font-medium transition-colors"
          >
            {tCommon('cancel')}
          </button>
          <button
            onClick={onSave}
            className="flex-1 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 font-medium transition-colors"
          >
            {tCommon('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
