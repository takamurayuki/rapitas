'use client';
// WorkflowConfigCard

import { ShieldCheck } from 'lucide-react';
import type { UserSettings } from '@/types';
import { useTranslations } from 'next-intl';

interface WorkflowConfigCardProps {
  settings: UserSettings | null;
  isSaving: boolean;
  onUpdateSettings: (updates: Partial<UserSettings>) => void;
}

/**
 * Renders workflow configuration toggles for plan approval and complexity analysis.
 *
 * @param settings - Current user settings / 現在のユーザー設定
 * @param isSaving - Whether a save is in progress / 保存中かどうか
 * @param onUpdateSettings - Callback to persist settings updates / 設定を保存するコールバック
 */
export function WorkflowConfigCard({
  settings,
  isSaving,
  onUpdateSettings,
}: WorkflowConfigCardProps) {
  const t = useTranslations('settings');

  const toggleClass = (enabled: boolean | undefined) =>
    `relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
      enabled ? 'bg-violet-500' : 'bg-zinc-300 dark:bg-zinc-600'
    }`;

  const thumbClass = (enabled: boolean | undefined) =>
    `pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
      enabled ? 'translate-x-5' : 'translate-x-0'
    }`;

  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden mt-8">
      <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-violet-500" />
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">{t('workflowConfig')}</h2>
        </div>
      </div>
      <div className="p-6 space-y-6">
        {/* Auto approve plan */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-zinc-900 dark:text-zinc-50">{t('autoApprovePlan')}</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {t('autoApproveDescription')}
            </p>
          </div>
          <button
            onClick={() => onUpdateSettings({ autoApprovePlan: !settings?.autoApprovePlan })}
            disabled={isSaving}
            className={toggleClass(settings?.autoApprovePlan)}
            role="switch"
            aria-checked={settings?.autoApprovePlan ?? false}
          >
            <span className={thumbClass(settings?.autoApprovePlan)} />
          </button>
        </div>

        {/* Auto complexity analysis */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
              {t('autoComplexityAnalysis')}
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {t('autoComplexityDescription')}
            </p>
          </div>
          <button
            onClick={() =>
              onUpdateSettings({
                autoComplexityAnalysis: !settings?.autoComplexityAnalysis,
              })
            }
            disabled={isSaving}
            className={toggleClass(settings?.autoComplexityAnalysis)}
            role="switch"
            aria-checked={settings?.autoComplexityAnalysis ?? false}
          >
            <span className={thumbClass(settings?.autoComplexityAnalysis)} />
          </button>
        </div>
      </div>
    </div>
  );
}
