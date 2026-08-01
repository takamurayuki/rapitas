'use client';

/**
 * CaptureStatusBar
 *
 * Bottom hint + save-status row shared by both quick-capture forms.
 */
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import type { CaptureStatus } from './capture-window';

interface CaptureStatusBarProps {
  hint: string;
  status: CaptureStatus;
}

/**
 * Render the hint text and the transient save status.
 *
 * @param props - Hint string and current status. / ヒントと保存状態。
 */
export function CaptureStatusBar({ hint, status }: CaptureStatusBarProps) {
  const t = useTranslations('quickCapture');
  return (
    <div className="shrink-0 flex items-center justify-between pl-8 text-xs text-zinc-500 dark:text-zinc-400">
      <span>{hint}</span>
      {status === 'saving' && <span>{t('saving')}</span>}
      {status === 'saved' && (
        <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
          {t('saved')}
        </span>
      )}
      {status === 'error' && <span className="text-red-600 dark:text-red-400">{t('failed')}</span>}
    </div>
  );
}
