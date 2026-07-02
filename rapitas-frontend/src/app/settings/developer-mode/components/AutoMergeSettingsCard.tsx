'use client';
// AutoMergeSettingsCard

import { useTranslations } from 'next-intl';
import { GitMerge } from 'lucide-react';
import type { UserSettings } from '@/types';

interface AutoMergeSettingsCardProps {
  settings: UserSettings | null;
  isSaving: boolean;
  onUpdateSettings: (updates: Partial<UserSettings>) => void;
}

const toggleClass = (enabled: boolean | undefined) =>
  `relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
    enabled ? 'bg-violet-500' : 'bg-zinc-300 dark:bg-zinc-600'
  }`;

const thumbClass = (enabled: boolean | undefined) =>
  `pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
    enabled ? 'translate-x-5' : 'translate-x-0'
  }`;

/**
 * Global automation defaults (auto-commit / auto-PR / auto-merge) applied to all
 * tasks. Per-task config overrides these; saved to UserSettings.
 *
 * @param settings - Current user settings. / 現在のユーザー設定
 * @param isSaving - Whether a save is in progress. / 保存中かどうか
 * @param onUpdateSettings - Callback to persist a partial update. / 部分更新を保存するコールバック
 */
export function AutoMergeSettingsCard({
  settings,
  isSaving,
  onUpdateSettings,
}: AutoMergeSettingsCardProps) {
  const t = useTranslations('settings.autoMergeSettingsCard');
  const autoCommit = settings?.autoCommitDefault ?? false;
  const autoCreatePR = settings?.autoCreatePRDefault ?? false;
  const autoMergePR = settings?.autoMergePRDefault ?? false;
  const threshold = settings?.mergeCommitThresholdDefault ?? 5;

  const Row = ({
    label,
    description,
    value,
    onToggle,
  }: {
    label: string;
    description: string;
    value: boolean;
    onToggle: () => void;
  }) => (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="font-medium text-zinc-900 dark:text-zinc-50">{label}</h3>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
      <button
        onClick={onToggle}
        disabled={isSaving}
        className={toggleClass(value)}
        role="switch"
        aria-checked={value}
      >
        <span className={thumbClass(value)} />
      </button>
    </div>
  );

  return (
    <div className="mt-8 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-indigo-dark-900">
      <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <GitMerge className="h-5 w-5 text-violet-500" />
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">{t('title')}</h2>
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('description')}</p>
      </div>
      <div className="space-y-6 p-6">
        <Row
          label={t('autoCommitLabel')}
          description={t('autoCommitDescription')}
          value={autoCommit}
          onToggle={() => onUpdateSettings({ autoCommitDefault: !autoCommit })}
        />
        <Row
          label={t('autoCreatePRLabel')}
          description={t('autoCreatePRDescription')}
          value={autoCreatePR}
          // Turning off auto-PR also disables auto-merge (nothing to merge).
          onToggle={() =>
            onUpdateSettings(
              autoCreatePR
                ? { autoCreatePRDefault: false, autoMergePRDefault: false }
                : { autoCreatePRDefault: true },
            )
          }
        />
        {autoCreatePR && (
          <div className="ml-4 space-y-4 border-l border-zinc-200 pl-4 dark:border-zinc-700">
            <Row
              label={t('autoMergeLabel')}
              description={t('autoMergeDescription')}
              value={autoMergePR}
              onToggle={() => onUpdateSettings({ autoMergePRDefault: !autoMergePR })}
            />
            {autoMergePR && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t('squashThresholdLabel')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={threshold}
                  disabled={isSaving}
                  onChange={(e) =>
                    onUpdateSettings({
                      mergeCommitThresholdDefault: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                  className="w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200"
                />
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  {t('squashThresholdSuffix')}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
