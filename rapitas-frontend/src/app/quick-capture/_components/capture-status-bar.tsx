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
  status: CaptureStatus;
}

/**
 * Render the transient save status (hints moved to the header info tooltip).
 *
 * @param props - Current status. / 保存状態。
 */
export function CaptureStatusBar({ status }: CaptureStatusBarProps) {
  const t = useTranslations('quickCapture');
  return (
    <div className="flex h-4 shrink-0 items-center justify-end text-xs text-zinc-500 dark:text-zinc-400">
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
