'use client';
// HomeQuickAdd
import { useTranslations } from 'next-intl';

interface HomeQuickAddProps {
  isQuickAdding: boolean;
  quickTaskTitle: string;
  onTitleChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/**
 * Inline quick-add panel shown below the toolbar when activated.
 *
 * @param props - Visibility state, input value, and action callbacks.
 * @returns The quick-add form or null when not active.
 */
export function HomeQuickAdd({
  isQuickAdding,
  quickTaskTitle,
  onTitleChange,
  onSubmit,
  onCancel,
}: HomeQuickAddProps) {
  const tc = useTranslations('common');
  const t = useTranslations('home');

  if (!isQuickAdding) return null;

  return (
    <div className="mb-4 p-3 bg-white dark:bg-indigo-dark-900 rounded-lg shadow-lg">
      <div className="flex gap-2 p-n2">
        <input
          type="text"
          value={quickTaskTitle}
          onChange={(e) => onTitleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit();
            if (e.key === 'Escape') onCancel();
          }}
          placeholder={t('taskTitlePlaceholder')}
          className="text-sm px-2 flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
          autoFocus
        />
        <button
          onClick={onSubmit}
          disabled={!quickTaskTitle.trim()}
          className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {tc('create')}
        </button>
      </div>
    </div>
  );
}
