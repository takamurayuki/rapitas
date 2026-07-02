'use client';
// OverviewCards

import { ArrowDownRight, ArrowUpRight, Database, Footprints, Network, Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { MemoryOverview } from '../types';

interface OverviewCardsProps {
  memoryOverview: MemoryOverview;
}

interface GrowthBadgeProps {
  value: number;
  label: string;
}

/**
 * Shows a coloured up/down arrow with the growth percentage and period label.
 *
 * @param value - Growth percentage (positive = growth, negative = decline).
 * @param label - Period label shown next to the percentage (e.g. "先週比").
 */
function GrowthBadge({ value, label }: GrowthBadgeProps) {
  const positive = value >= 0;
  return (
    <p
      className={`flex items-center gap-0.5 truncate text-xs ${
        positive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
      }`}
    >
      {positive ? (
        <ArrowUpRight className="h-3 w-3 shrink-0" />
      ) : (
        <ArrowDownRight className="h-3 w-3 shrink-0" />
      )}
      {positive ? '+' : ''}
      {value.toFixed(1)}%<span className="ml-0.5 text-zinc-500 dark:text-zinc-400">{label}</span>
    </p>
  );
}

/**
 * Renders the four memory overview stats as a compact neutral KPI bar.
 *
 * NOTE: Replaced the full-height multi-hue gradient cards with the dashboard's
 * KPI-bar pattern (borders, single-hue icons) — the gradient stat-card grid is
 * a banned template per ui-design-language.md §2 tells #3/#6. The Sparkles
 * decoration became Footprints (episodic memory = traces of past runs) —
 * History already means タイムライン/履歴 elsewhere, per ICON_POLICY.
 *
 * @param memoryOverview - Memory statistics including totals and growth rates.
 */
export function OverviewCards({ memoryOverview }: OverviewCardsProps) {
  const t = useTranslations('agents.memory.overviewCards');
  const totalMemory =
    memoryOverview.totalMemorySize.nodes +
    memoryOverview.totalMemorySize.patterns +
    memoryOverview.totalMemorySize.episodes;

  return (
    <div className="mb-8 grid grid-cols-2 divide-x divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white md:grid-cols-4 md:divide-y-0 dark:divide-zinc-700 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="flex items-center gap-3 px-4 py-3">
        <Database className="h-5 w-5 shrink-0 text-indigo-500" />
        <div className="min-w-0">
          <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
            {totalMemory.toLocaleString()}
          </div>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{t('totalMemory')}</p>
          <GrowthBadge value={memoryOverview.growthRate.weekly} label={t('weeklyChange')} />
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <Network className="h-5 w-5 shrink-0 text-emerald-500" />
        <div className="min-w-0">
          <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
            {memoryOverview.totalMemorySize.nodes.toLocaleString()}
          </div>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{t('knowledgeNodes')}</p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {t('patterns', { count: memoryOverview.totalMemorySize.patterns })}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <Target className="h-5 w-5 shrink-0 text-purple-500" />
        <div className="min-w-0">
          <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
            {(memoryOverview.currentSuccessRate * 100).toFixed(1)}%
          </div>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{t('successRate')}</p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {t('experiments', { count: memoryOverview.totalMemorySize.experiments })}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <Footprints className="h-5 w-5 shrink-0 text-amber-500" />
        <div className="min-w-0">
          <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
            {memoryOverview.totalMemorySize.episodes.toLocaleString()}
          </div>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{t('episodes')}</p>
          <GrowthBadge value={memoryOverview.growthRate.monthly} label={t('monthlyChange')} />
        </div>
      </div>
    </div>
  );
}
