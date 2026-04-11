'use client';

/**
 * daily-schedule/_components/BlockList
 *
 * Renders the sortable list of schedule blocks and a per-category time
 * summary bar chart. Not responsible for data fetching or modal state.
 */

import { Clock, Bell, Edit2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { DailyScheduleBlock } from '@/types';
import {
  CATEGORY_OPTIONS,
  getCategoryIcon,
  timeToMinutes,
  getDurationParts,
} from './schedule-utils';

type BlockListProps = {
  blocks: DailyScheduleBlock[];
  hoveredBlock: number | null;
  onBlockHover: (id: number | null) => void;
  onEdit: (block: DailyScheduleBlock) => void;
  onDelete: (id: number) => void;
};

/**
 * Renders the schedule block list sorted by start time, and a category
 * coverage summary with progress bars.
 *
 * @param blocks - All schedule blocks / スケジュールブロック一覧
 * @param hoveredBlock - Id of the currently hovered block / ホバー中ブロックID
 * @param onBlockHover - Called on mouse enter/leave per row / ホバーコールバック
 * @param onEdit - Called when the edit button is clicked / 編集コールバック
 * @param onDelete - Called when the delete button is clicked / 削除コールバック
 */
export function BlockList({
  blocks,
  hoveredBlock,
  onBlockHover,
  onEdit,
  onDelete,
}: BlockListProps) {
  const t = useTranslations('habits');

  const formatDuration = (startTime: string, endTime: string): string => {
    const { h, m } = getDurationParts(startTime, endTime);
    if (h === 0) return t('durationMinutes', { m });
    if (m === 0) return t('durationHours', { h });
    return t('durationHoursMinutes', { h, m });
  };

  return (
    <div className="space-y-4">
      {/* Block rows */}
      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
          {t('blockList')}
        </h2>

        {blocks.length === 0 ? (
          <div className="text-center py-8">
            <Clock className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
            <p className="text-zinc-500 dark:text-zinc-400">{t('noBlocks')}</p>
            <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-1">
              {t('noBlocksHint')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {blocks
              .sort(
                (a, b) =>
                  timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
              )
              .map((block) => {
                const Icon = getCategoryIcon(block.category);
                const isHovered = hoveredBlock === block.id;

                return (
                  <div
                    key={block.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                      isHovered
                        ? 'border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20'
                        : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-750'
                    }`}
                    onMouseEnter={() => onBlockHover(block.id)}
                    onMouseLeave={() => onBlockHover(null)}
                  >
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: block.color + '20' }}
                    >
                      <Icon
                        className="w-5 h-5"
                        style={{ color: block.color }}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-zinc-900 dark:text-zinc-50 truncate">
                          {block.label}
                        </span>
                        {block.isNotify && (
                          <Bell className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        )}
                      </div>
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">
                        {block.startTime}〜{block.endTime}（
                        {formatDuration(block.startTime, block.endTime)}）
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => onEdit(block)}
                        className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onDelete(block.id)}
                        className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Category coverage summary */}
      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-3">
          {t('categorySummary')}
        </h3>
        <div className="space-y-2">
          {CATEGORY_OPTIONS.map((cat) => {
            const catBlocks = blocks.filter((b) => b.category === cat.value);
            if (catBlocks.length === 0) return null;

            const totalCatMin = catBlocks.reduce((sum, block) => {
              const s = timeToMinutes(block.startTime);
              let e = timeToMinutes(block.endTime);
              if (e <= s) e += 1440;
              return sum + Math.min(e - s, 1440);
            }, 0);

            const h = Math.floor(totalCatMin / 60);
            const m = totalCatMin % 60;
            const pct = Math.round((totalCatMin / 1440) * 100);
            const CatIcon = cat.icon;

            return (
              <div key={cat.value} className="flex items-center gap-3">
                <CatIcon className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                <span className="text-sm text-zinc-700 dark:text-zinc-300 w-16">
                  {t(cat.labelKey)}
                </span>
                <div className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: cat.defaultColor,
                    }}
                  />
                </div>
                <span className="text-xs text-zinc-500 dark:text-zinc-400 w-20 text-right">
                  {h}h{m > 0 ? `${m}m` : ''} ({pct}%)
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
