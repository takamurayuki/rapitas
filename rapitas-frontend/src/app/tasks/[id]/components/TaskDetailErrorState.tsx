'use client';
// TaskDetailErrorState
import { useTranslations } from 'next-intl';

export interface TaskDetailErrorStateProps {
  /** Error message to display. Pass null to show the generic "not found" message. */
  error: string | null;
  onBackToHome: () => void;
}

/**
 * Full-page error/not-found card for the task detail view.
 *
 * @param props - Error message and navigation callback.
 */
export default function TaskDetailErrorState({ error, onBackToHome }: TaskDetailErrorStateProps) {
  const t = useTranslations('task');

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-background flex items-center justify-center scrollbar-thin">
      <div className="text-center bg-white dark:bg-indigo-dark-900 rounded-2xl p-8 shadow-xl border border-zinc-200 dark:border-zinc-800">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <span className="text-3xl">!</span>
        </div>
        <p className="text-red-600 dark:text-red-400 mb-4 font-medium">{error || t('notFound')}</p>
        <button
          onClick={onBackToHome}
          className="px-6 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors font-medium"
        >
          {t('backToHome')}
        </button>
      </div>
    </div>
  );
}
