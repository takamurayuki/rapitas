'use client';
// ガントチャートページ

import { useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { GanttView } from '@/feature/tasks/components/gantt';
import { useFilterDataStore } from '@/stores/filter-data-store';
import { ThemePicker } from '@/components/ui/theme-picker';

export default function GanttPage() {
  const t = useTranslations('task');
  const tCommon = useTranslations('common');
  const [selectedThemeId, setSelectedThemeId] = useState<number | undefined>(undefined);
  const themes = useFilterDataStore((s) => s.themes);
  const categories = useFilterDataStore((s) => s.categories);
  const initFilterData = useFilterDataStore((s) => s.initializeData);

  useEffect(() => {
    initFilterData();
  }, [initFilterData]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {t('ganttView.title')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">{t('ganttView.pageDescription')}</p>
        </div>

        {/* テーマフィルタ
            NOTE: was three rows of ~40 coloured chips; the picker groups them
            by category behind one button, with "all" as its first choice. */}
        {themes.length > 0 && (
          <div className="mb-4 flex items-center gap-2">
            <Layers className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
            <ThemePicker
              themes={themes}
              categories={categories}
              value={selectedThemeId ?? null}
              onChange={(theme) => setSelectedThemeId(theme?.id)}
              allLabel={tCommon('all')}
              label={t('theme')}
              className="w-full max-w-xs"
            />
          </div>
        )}

        {/* ガントチャート — key でテーマ変更時に確実に再マウント */}
        <GanttView key={selectedThemeId ?? 'all'} className="shadow-lg" themeId={selectedThemeId} />
      </div>
    </div>
  );
}
