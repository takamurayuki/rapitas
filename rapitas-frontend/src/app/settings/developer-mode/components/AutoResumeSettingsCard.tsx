'use client';
// AutoResumeSettingsCard

import { RotateCcw } from 'lucide-react';
import type { UserSettings } from '@/types';
import { useTranslations } from 'next-intl';
import { SkeletonBlock } from '@/components/ui/LoadingSpinner';

interface AutoResumeSettingsCardProps {
  settings: UserSettings | null;
  isSaving: boolean;
  onToggle: () => void;
}

/**
 * Renders the auto-resume interrupted tasks toggle card.
 *
 * @param settings - Current user settings / 現在のユーザー設定
 * @param isSaving - Whether a save is in progress for this card specifically / このカードの保存中フラグ
 * @param onToggle - Callback to toggle the auto-resume setting / 自動再開設定を切り替えるコールバック
 */
export function AutoResumeSettingsCard({
  settings,
  isSaving,
  onToggle,
}: AutoResumeSettingsCardProps) {
  const t = useTranslations('settings');

  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden mt-8">
      <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <RotateCcw className="w-5 h-5 text-violet-500" />
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
            {t('devAutoResumeSettings')}
          </h2>
        </div>
      </div>
      <div className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
              {t('devAutoResumeInterrupted')}
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {t('devAutoResumeDescription')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSaving && <SkeletonBlock className="w-4 h-4 rounded" />}
            <button
              onClick={onToggle}
              disabled={isSaving}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                settings?.autoResumeInterruptedTasks
                  ? 'bg-violet-600'
                  : 'bg-zinc-300 dark:bg-zinc-600'
              }`}
              role="switch"
              aria-checked={settings?.autoResumeInterruptedTasks ?? false}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  settings?.autoResumeInterruptedTasks ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
