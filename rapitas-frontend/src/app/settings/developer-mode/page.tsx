'use client';
// DeveloperModeSettingsPage

import { Settings, AlertCircle, BarChart3, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useDeveloperModeSettings } from './hooks/useDeveloperModeSettings';
import { TaskCreationSettingsCard } from './components/TaskCreationSettingsCard';
import { AutoRunSettingsCard } from './components/AutoRunSettingsCard';
import { AutoResumeSettingsCard } from './components/AutoResumeSettingsCard';
import { WorkflowConfigCard } from './components/WorkflowConfigCard';
import { AutoMergeSettingsCard } from './components/AutoMergeSettingsCard';
import { TaskCleanupSection } from '../_components/TaskCleanupSection';

export default function DeveloperModeSettingsPage() {
  const t = useTranslations('settings');
  const {
    settings,
    isLoading,
    isSaving,
    isSavingAutoResume,
    error,
    localDelay,
    updateSettings,
    toggleAutoResume,
    handleDelayChange,
    handleDelayBlur,
  } = useDeveloperModeSettings();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2.5 bg-violet-100 dark:bg-violet-900/30 rounded-xl">
          <Settings className="w-6 h-6 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {t('devModeTitle')}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('devModeSubtitle')}</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      <div className="space-y-6">
        <TaskCreationSettingsCard
          settings={settings}
          isSaving={isSaving}
          localDelay={localDelay}
          onUpdateSettings={updateSettings}
          onDelayChange={handleDelayChange}
          onDelayBlur={handleDelayBlur}
        />

        <AutoRunSettingsCard
          settings={settings}
          isSaving={isSaving}
          onUpdateSettings={updateSettings}
        />

        <AutoResumeSettingsCard
          settings={settings}
          isSaving={isSavingAutoResume}
          onToggle={toggleAutoResume}
        />

        <WorkflowConfigCard
          settings={settings}
          isSaving={isSaving}
          onUpdateSettings={updateSettings}
        />

        <AutoMergeSettingsCard
          settings={settings}
          isSaving={isSaving}
          onUpdateSettings={updateSettings}
        />

        {/* Error analytics entry card */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <BarChart3 className="w-5 h-5 text-zinc-400" />
              <div>
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">エラー分析</h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                  バックエンドログのエラー傾向を把握する
                </p>
              </div>
            </div>
          </div>
          <div className="p-6">
            <Link
              href="/settings/developer-mode/error-analytics"
              className="block group p-4 bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg">
                    <BarChart3 className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-zinc-900 dark:text-zinc-50 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                      エラー分析ダッシュボード
                    </h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                      ERROR/WARN ログのカテゴリ別集計・先週比トレンドを確認
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors" />
              </div>
            </Link>
          </div>
        </div>

        <TaskCleanupSection />
      </div>
    </div>
  );
}
