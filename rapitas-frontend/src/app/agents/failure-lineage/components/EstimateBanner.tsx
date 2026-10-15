'use client';
/**
 * EstimateBanner
 *
 * Always-visible notice that every parent/child relation on the page is an
 * inference from temporal proximity and shared attributes, not a fact.
 */
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function EstimateBanner() {
  const t = useTranslations('agents.failureLineage');
  return (
    <div
      role="note"
      data-testid="estimate-banner"
      className="mb-6 p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs flex items-start gap-2 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
    >
      <Info className="w-4 h-4 shrink-0 mt-0.5" />
      <span>{t('estimateBanner')}</span>
    </div>
  );
}
