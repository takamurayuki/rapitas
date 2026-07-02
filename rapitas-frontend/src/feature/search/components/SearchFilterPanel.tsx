'use client';

import React from 'react';
import { useTranslations } from 'next-intl';

export interface SearchFilters {
  types: string[];
  statuses: string[];
}

interface SearchFilterPanelProps {
  filters: SearchFilters;
  onFilterChange: (filters: SearchFilters) => void;
}

function toggleValue(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

export default function SearchFilterPanel({ filters, onFilterChange }: SearchFilterPanelProps) {
  const t = useTranslations('search');
  const tCommon = useTranslations('common');

  const TYPE_OPTIONS = [
    { value: 'task', label: t('filterTask') },
    { value: 'note', label: t('filterPanel.typeNote') },
    { value: 'comment', label: t('filterComment') },
  ];

  const STATUS_OPTIONS = [
    { value: 'active', label: t('filterPanel.statusActive') },
    { value: 'done', label: tCommon('completed') },
  ];

  return (
    <div className="flex flex-col gap-4 p-3 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg">
      <div>
        <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase mb-2">
          {t('filterPanel.typeHeading')}
        </h4>
        <div className="flex flex-wrap gap-2">
          {TYPE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={filters.types.includes(opt.value)}
                onChange={() =>
                  onFilterChange({
                    ...filters,
                    types: toggleValue(filters.types, opt.value),
                  })
                }
                className="rounded border-zinc-300 dark:border-zinc-600 text-indigo-600 focus:ring-indigo-500"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase mb-2">
          {t('filterPanel.statusHeading')}
        </h4>
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={filters.statuses.includes(opt.value)}
                onChange={() =>
                  onFilterChange({
                    ...filters,
                    statuses: toggleValue(filters.statuses, opt.value),
                  })
                }
                className="rounded border-zinc-300 dark:border-zinc-600 text-indigo-600 focus:ring-indigo-500"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
