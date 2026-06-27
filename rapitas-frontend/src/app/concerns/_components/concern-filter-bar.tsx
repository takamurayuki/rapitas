/**
 * ConcernFilterBar
 *
 * Status / type / severity / theme filter controls for the concern list.
 * Pure presentational — all state lives in useConcerns.
 */
'use client';
import type { Dispatch, SetStateAction } from 'react';
import type { Theme } from '@/types';
import {
  STATUS_TABS,
  TYPE_META,
  TYPE_ORDER,
  SEVERITY_META,
  SEVERITY_ORDER,
  type ConcernSeverity,
  type ConcernStatus,
  type ConcernType,
} from './concern-shared';

interface ConcernFilterBarProps {
  statusFilter: ConcernStatus | 'all';
  setStatusFilter: Dispatch<SetStateAction<ConcernStatus | 'all'>>;
  typeFilter: ConcernType | 'all';
  setTypeFilter: Dispatch<SetStateAction<ConcernType | 'all'>>;
  severityFilter: ConcernSeverity | 'all';
  setSeverityFilter: Dispatch<SetStateAction<ConcernSeverity | 'all'>>;
  themeFilter: number | 'all';
  setThemeFilter: Dispatch<SetStateAction<number | 'all'>>;
  /** Themes with a working directory (the only valid publish targets). */
  workingDirThemes: Theme[];
}

/**
 * Render the concern-list filter bar.
 *
 * @param props - Filter state and setters from useConcerns. / useConcerns のフィルタ状態とセッター。
 */
export function ConcernFilterBar({
  statusFilter,
  setStatusFilter,
  typeFilter,
  setTypeFilter,
  severityFilter,
  setSeverityFilter,
  themeFilter,
  setThemeFilter,
  workingDirThemes,
}: ConcernFilterBarProps) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === tab.value
                ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <select
        value={typeFilter}
        onChange={(e) => setTypeFilter(e.target.value as ConcernType | 'all')}
        className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800"
      >
        <option value="all">すべての種別</option>
        {TYPE_ORDER.map((ty) => (
          <option key={ty} value={ty}>
            {TYPE_META[ty].label}
          </option>
        ))}
      </select>
      <select
        value={severityFilter}
        onChange={(e) => setSeverityFilter(e.target.value as ConcernSeverity | 'all')}
        className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800"
      >
        <option value="all">すべての優先度</option>
        {SEVERITY_ORDER.map((sv) => (
          <option key={sv} value={sv}>
            {SEVERITY_META[sv].label}
          </option>
        ))}
      </select>
      <select
        value={themeFilter === 'all' ? '' : String(themeFilter)}
        onChange={(e) => setThemeFilter(e.target.value ? parseInt(e.target.value) : 'all')}
        className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800"
      >
        <option value="">すべてのテーマ</option>
        {workingDirThemes.map((th) => (
          <option key={th.id} value={th.id}>
            {th.name}
          </option>
        ))}
      </select>
    </div>
  );
}
