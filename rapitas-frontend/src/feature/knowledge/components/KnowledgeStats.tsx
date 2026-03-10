'use client';

import { useTranslations } from 'next-intl';
import type { KnowledgeStats as KnowledgeStatsType } from '../types';

interface KnowledgeStatsProps {
  stats: KnowledgeStatsType;
}

export function KnowledgeStats({ stats }: KnowledgeStatsProps) {
  const t = useTranslations('knowledge.stats');
  const tk = useTranslations('knowledge');

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard label={t('totalEntries')} value={stats.totalEntries} />
      <StatCard
        label={t('averageConfidence')}
        value={`${Math.round(stats.averageConfidence * 100)}%`}
      />
      <StatCard
        label={t('averageDecay')}
        value={`${Math.round(stats.averageDecayScore * 100)}%`}
      />
      <StatCard label={t('recentlyAccessed')} value={stats.recentlyAccessed} />

      {Object.keys(stats.byCategory).length > 0 && (
        <div className="col-span-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            {t('byCategory')}
          </h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.byCategory).map(([key, count]) => (
              <span
                key={key}
                className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
              >
                {tk(`categories.${key}`)}: {count}
              </span>
            ))}
          </div>
        </div>
      )}

      {Object.keys(stats.byStage).length > 0 && (
        <div className="col-span-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            {t('byStage')}
          </h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.byStage).map(([key, count]) => (
              <span
                key={key}
                className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
              >
                {tk(`stages.${key}`)}: {count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
        {value}
      </p>
    </div>
  );
}
