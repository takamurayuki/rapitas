/**
 * AiAssistantSettingsCard
 *
 * Settings card for enabling/disabling the AI assistant feature in developer mode.
 */

'use client';

import { Bot } from 'lucide-react';
import type { UserSettings } from '@/types';
import { useTranslations } from 'next-intl';

interface AiAssistantSettingsCardProps {
  settings: UserSettings | null;
  isSaving: boolean;
  onUpdateSettings: (updates: Partial<UserSettings>) => void;
}

/**
 * Renders the AI assistant toggle card.
 *
 * @param settings - Current user settings / 現在のユーザー設定
 * @param isSaving - Whether a save is in progress / 保存中かどうか
 * @param onUpdateSettings - Callback to persist settings updates / 設定を保存するコールバック
 */
export function AiAssistantSettingsCard({
  settings,
  isSaving,
  onUpdateSettings,
}: AiAssistantSettingsCardProps) {
  const t = useTranslations('settings');

  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <Bot className="w-5 h-5 text-violet-500" />
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
            {t('devAiAssistantSettings')}
          </h2>
        </div>
      </div>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
              {t('devEnableAiAssistant')}
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {t('devEnableAiAssistantDescription')}
            </p>
          </div>
          <button
            onClick={() =>
              onUpdateSettings({
                aiTaskAnalysisDefault: !settings?.aiTaskAnalysisDefault,
              })
            }
            disabled={isSaving}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              settings?.aiTaskAnalysisDefault
                ? 'bg-violet-500'
                : 'bg-zinc-300 dark:bg-zinc-600'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                settings?.aiTaskAnalysisDefault ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
