/**
 * IdeaFilterBar
 *
 * Status / priority / category / theme filter controls for the idea list.
 * Pure presentational — all state lives in useIdeaBox.
 */
'use client';
import type { Dispatch, SetStateAction } from 'react';
import type { Category, Theme } from '@/types';
import type { IdeaPriority } from './idea-box.types';

interface IdeaFilterBarProps {
  statusFilter: 'open' | 'used' | 'all';
  setStatusFilter: Dispatch<SetStateAction<'open' | 'used' | 'all'>>;
  priorityFilter: 'all' | IdeaPriority;
  setPriorityFilter: Dispatch<SetStateAction<'all' | IdeaPriority>>;
  filterCategoryId: number | null;
  onFilterCategoryChange: (id: number | null) => void;
  filterThemeId: number | null;
  setFilterThemeId: Dispatch<SetStateAction<number | null>>;
  categories: Category[];
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
  filterCategoryId,
  onFilterCategoryChange,
  filterThemeId,
  setFilterThemeId,
  categories,
  filterThemes,
  searchQuery,
}: IdeaFilterBarProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {/* Status */}
      <div className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
        {(
          [
            { value: 'open', label: '未対応' },
            { value: 'used', label: 'タスク化済み' },
            { value: 'all', label: 'すべて' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === tab.value
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* Priority */}
      <select
        value={priorityFilter}
        onChange={(e) => setPriorityFilter(e.target.value as 'all' | IdeaPriority)}
        className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800"
      >
        <option value="all">すべての優先度</option>
        <option value="urgent">緊急</option>
        <option value="high">高</option>
        <option value="medium">中</option>
        <option value="low">低</option>
      </select>
      <select
        value={filterCategoryId ?? ''}
        onChange={(e) => onFilterCategoryChange(e.target.value ? parseInt(e.target.value) : null)}
        className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800"
      >
        <option value="">すべてのカテゴリ</option>
        {categories.map((cat) => (
          <option key={cat.id} value={cat.id}>
            {cat.name}
          </option>
        ))}
      </select>
      <select
        value={filterThemeId ?? ''}
        onChange={(e) => setFilterThemeId(e.target.value ? parseInt(e.target.value) : null)}
        className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800"
      >
        <option value="">すべてのテーマ</option>
        {filterThemes.map((th) => (
          <option key={th.id} value={th.id}>
            {th.name}
          </option>
        ))}
      </select>
      {searchQuery && (
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
          検索: 「{searchQuery}」
        </span>
      )}
    </div>
  );
}
