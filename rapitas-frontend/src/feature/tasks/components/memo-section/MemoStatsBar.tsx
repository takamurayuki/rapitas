/**
 * MemoStatsBar
 *
 * Displays the memo count, pinned count, timeline toggle, filter toggle,
 * active filter chips, and the bulk-analyze quick action button.
 * Purely presentational — all state and callbacks are provided by MemoSection.
 */

'use client';

import { MessageSquare, Pin, History, Filter, Sparkles } from 'lucide-react';
import type { MemoType } from './types';
import { MEMO_TYPE_CONFIG } from './types';

type MemoStatsBarProps = {
  noteCount: number;
  pinnedCount: number;
  typeStats: Record<MemoType, number>;
  filterType: MemoType | 'all';
  showFilters: boolean;
  showTimeline: boolean;
  onSetFilterType: (t: MemoType | 'all') => void;
  onToggleFilters: () => void;
  onToggleTimeline: () => void;
  onBulkAnalyze: () => void;
};

/**
 * Renders the stats/controls bar at the top of the MemoSection when notes exist.
 *
 * @param noteCount - Total visible note count / 表示中のメモ件数
 * @param pinnedCount - Number of pinned notes / ピン留めされたメモ数
 * @param typeStats - Per-type note counts used to render filter buttons / 種別ごとのメモ数
 * @param filterType - Currently active filter / 現在のフィルター
 * @param showFilters - Whether the filter chip row is visible / フィルター行の表示フラグ
 * @param showTimeline - Whether the timeline panel is visible / タイムラインの表示フラグ
 * @param onSetFilterType - Updates the active filter / フィルター更新コールバック
 * @param onToggleFilters - Toggles filter visibility / フィルター表示切り替え
 * @param onToggleTimeline - Toggles timeline visibility / タイムライン表示切り替え
 * @param onBulkAnalyze - Triggers bulk AI analysis / 一括AI分析コールバック
 */
export function MemoStatsBar({
  noteCount,
  pinnedCount,
  typeStats,
  filterType,
  showFilters,
  showTimeline,
  onSetFilterType,
  onToggleFilters,
  onToggleTimeline,
  onBulkAnalyze,
}: MemoStatsBarProps) {
  return (
    <div className="flex flex-col gap-2 mb-3">
      {/* Count row */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-[10px] text-zinc-400 flex items-center gap-1">
          <MessageSquare className="w-3 h-3" />
          {noteCount}件
        </span>
        {pinnedCount > 0 && (
          <span className="text-[10px] text-blue-500 flex items-center gap-1">
            <Pin className="w-2.5 h-2.5" />
            {pinnedCount}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={onToggleTimeline}
          className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
            showTimeline
              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
              : 'text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
          }`}
        >
          <History className="w-3 h-3" />
          履歴統合表示
        </button>
        <button
          onClick={onToggleFilters}
          className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
            showFilters
              ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800'
              : 'text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
          }`}
        >
          <Filter className="w-3 h-3" />
          フィルター
        </button>
      </div>

      {/* Type filter chips */}
      {showFilters && (
        <div className="flex flex-wrap gap-1.5 px-1">
          <button
            onClick={() => onSetFilterType('all')}
            className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-full border transition-colors ${
              filterType === 'all'
                ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-600'
                : 'text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
            }`}
          >
            全て ({Object.values(typeStats).reduce((a, b) => a + b, 0)})
          </button>
          {(Object.keys(MEMO_TYPE_CONFIG) as MemoType[]).map((type) => {
            const config = MEMO_TYPE_CONFIG[type];
            const Icon = config.icon;
            const count = typeStats[type];
            if (count === 0) return null;

            return (
              <button
                key={type}
                onClick={() => onSetFilterType(type)}
                className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-full border transition-colors ${
                  filterType === type
                    ? `${config.color.badge} border-current`
                    : 'text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                }`}
              >
                <Icon className="w-2.5 h-2.5" />
                {config.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Bulk analysis quick action */}
      <div className="flex items-center gap-2 px-1 mt-2">
        <button
          onClick={onBulkAnalyze}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-full hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
        >
          <Sparkles className="w-2.5 h-2.5" />
          全メモ一括分析
        </button>
      </div>
    </div>
  );
}
