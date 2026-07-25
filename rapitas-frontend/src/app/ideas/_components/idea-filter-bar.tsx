/**
 * IdeaFilterBar
 *
 * Status / priority / theme filter controls for the idea list.
 * Pure presentational — all state lives in useIdeaBox.
 */
'use client';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import type { Theme } from '@/types';
import type { IdeaPriority } from './idea-box.types';

interface IdeaFilterBarProps {
  statusFilter: 'open' | 'used' | 'all';
  setStatusFilter: Dispatch<SetStateAction<'open' | 'used' | 'all'>>;
  priorityFilter: 'all' | IdeaPriority;
  setPriorityFilter: Dispatch<SetStateAction<'all' | IdeaPriority>>;
  filterThemeId: number | null;
  setFilterThemeId: Dispatch<SetStateAction<number | null>>;
  filterThemes: Theme[];
  searchQuery: string;
}

/**
 * Render the idea-list filter bar.
 *
 * @param props - Filter state and setters from useIdeaBox. / useIdeaBox のフィルタ状態とセッター。
 */
export function IdeaFilterBar({
  statusFilter,
  setStatusFilter,
  priorityFilter,
  setPriorityFilter,
  filterThemeId,
  setFilterThemeId,
  filterThemes,
  searchQuery,
}: IdeaFilterBarProps) {
  const t = useTranslations('ideaBox');
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {/* Status — amber, matching the idea icon/add-button palette (see idea-card.tsx). */}
      <div className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
        {(['open', 'used', 'all'] as const).map((value) => (
          <button
            key={value}
            onClick={() => setStatusFilter(value)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === value
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            {t(`filterBar.status.${value}`)}
          </button>
        ))}
      </div>
      {/* Priority */}
      <select
        value={priorityFilter}
        onChange={(e) => setPriorityFilter(e.target.value as 'all' | IdeaPriority)}
        className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800"
      >
        <option value="all">{t('filterBar.allPriorities')}</option>
        <option value="urgent">{t('filterBar.priority.urgent')}</option>
        <option value="high">{t('filterBar.priority.high')}</option>
        <option value="medium">{t('filterBar.priority.medium')}</option>
        <option value="low">{t('filterBar.priority.low')}</option>
      </select>
      <select
        value={filterThemeId ?? ''}
        onChange={(e) => setFilterThemeId(e.target.value ? parseInt(e.target.value) : null)}
        className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800"
      >
        <option value="">{t('filterBar.allThemes')}</option>
        {filterThemes.map((th) => (
          <option key={th.id} value={th.id}>
            {th.name}
          </option>
        ))}
      </select>
      {searchQuery && (
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {t('filterBar.searchLabel', { query: searchQuery })}
        </span>
      )}
    </div>
  );
}
