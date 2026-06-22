'use client';
// ガントチャートページ

import React, { useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import { GanttView } from '@/feature/tasks/components/gantt';
import { useFilterDataStore } from '@/stores/filter-data-store';

export default function GanttPage() {
  const [selectedThemeId, setSelectedThemeId] = useState<number | undefined>(undefined);
  const themes = useFilterDataStore((s) => s.themes);
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
            ガントチャート
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            タスクを時系列で俯瞰できます。バーにカーソルを合わせると詳細が表示されます。
          </p>
        </div>

        {/* テーマフィルタ */}
        {themes.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Layers className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
            <button
              onClick={() => setSelectedThemeId(undefined)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                selectedThemeId === undefined
                  ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              すべて
            </button>
            {themes.map((theme) => {
              const isSelected = selectedThemeId === theme.id;
              return (
                <button
                  key={theme.id}
                  onClick={() => setSelectedThemeId(isSelected ? undefined : theme.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isSelected ? 'ring-1 ring-offset-1' : 'opacity-80 hover:opacity-100'
                  }`}
                  style={{
                    backgroundColor: isSelected ? theme.color : `${theme.color}25`,
                    color: isSelected ? '#fff' : theme.color,
                    ['--tw-ring-color' as string]: theme.color,
                  }}
                >
                  {theme.name}
                </button>
              );
            })}
          </div>
        )}

        {/* ガントチャート — key でテーマ変更時に確実に再マウント */}
        <GanttView key={selectedThemeId ?? 'all'} className="shadow-lg" themeId={selectedThemeId} />
      </div>
    </div>
  );
}
