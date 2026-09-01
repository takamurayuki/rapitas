/**
 * pomodoroFloatEmptyState
 *
 * Static message shown in the floating window when no Pomodoro is running.
 * The float window has no task picker, so starting a new session must
 * happen in the main window instead.
 */
'use client';

import { useTranslations } from 'next-intl';

export default function PomodoroFloatEmptyState() {
  const t = useTranslations('pomodoro');

  return (
    <p className="px-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
      {t('floatEmptyState')}
    </p>
  );
}
