'use client';
/**
 * triage-confirm-step
 *
 * Banner shown while an irreversible approval waits for its second key press.
 * Not responsible for deciding when confirmation is required or for committing.
 */

import { useTranslations } from 'next-intl';

interface TriageConfirmStepProps {
  /** Display form of the configured approve key / 承認キーの表示 */
  approveKey: string;
  onCancel: () => void;
}

/**
 * Render the confirmation prompt with a cancel button (Esc works too).
 */
export function TriageConfirmStep({ approveKey, onCancel }: TriageConfirmStepProps) {
  const t = useTranslations('triage.confirm');
  return (
    <div
      role="group"
      aria-label={t('title')}
      className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4"
    >
      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">{t('title')}</p>
      <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
        {t('body', { key: approveKey })}
      </p>
      <button
        type="button"
        onClick={onCancel}
        className="mt-3 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/60"
      >
        {t('cancel')}
      </button>
    </div>
  );
}
