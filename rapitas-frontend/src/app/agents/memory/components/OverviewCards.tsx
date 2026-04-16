'use client';
// OverviewCards

import {
  ArrowDownRight,
  ArrowUpRight,
  Database,
  Network,
  Sparkles,
  Target,
} from 'lucide-react';
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
  return (
    <div className="mt-3 flex items-center gap-1 text-sm">
      {value >= 0 ? (
        <>
          <ArrowUpRight className="w-4 h-4" />
          <span>+{value.toFixed(1)}%</span>
        </>
      ) : (
        <>
          <ArrowDownRight className="w-4 h-4" />
          <span>{value.toFixed(1)}%</span>
        </>
      )}
      <span className="opacity-70 ml-1">{label}</span>
    </div>
  );
}

/**
 * Renders the four gradient overview stat cards.
 *
 * @param memoryOverview - Memory statistics including totals and growth rates.
 */
export function OverviewCards({ memoryOverview }: OverviewCardsProps) {
  const totalMemory =
    memoryOverview.totalMemorySize.nodes +
    memoryOverview.totalMemorySize.patterns +
    memoryOverview.totalMemorySize.episodes;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {/* Total memory */}
      <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-blue-100 text-sm">記憶総量</p>
            <p className="text-2xl font-bold">{totalMemory.toLocaleString()}</p>
          </div>
          <Database className="w-8 h-8 text-blue-200" />
        </div>
        <GrowthBadge value={memoryOverview.growthRate.weekly} label="先週比" />
      </div>

      {/* Knowledge nodes */}
      <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white rounded-xl p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-emerald-100 text-sm">ナレッジノード</p>
            <p className="text-2xl font-bold">
              {memoryOverview.totalMemorySize.nodes.toLocaleString()}
            </p>
          </div>
          <Network className="w-8 h-8 text-emerald-200" />
        </div>
        <p className="mt-3 text-sm text-emerald-100">
          パターン: {memoryOverview.totalMemorySize.patterns}
        </p>
      </div>

      {/* Success rate */}
      <div className="bg-gradient-to-br from-purple-500 to-purple-600 text-white rounded-xl p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-purple-100 text-sm">成功率</p>
            <p className="text-2xl font-bold">
              {(memoryOverview.currentSuccessRate * 100).toFixed(1)}%
            </p>
          </div>
          <Target className="w-8 h-8 text-purple-200" />
        </div>
        <p className="mt-3 text-sm text-purple-100">
          実験数: {memoryOverview.totalMemorySize.experiments}
        </p>
      </div>

      {/* Episodes */}
      <div className="bg-gradient-to-br from-amber-500 to-amber-600 text-white rounded-xl p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-amber-100 text-sm">エピソード記憶</p>
            <p className="text-2xl font-bold">
              {memoryOverview.totalMemorySize.episodes.toLocaleString()}
            </p>
          </div>
          <Sparkles className="w-8 h-8 text-amber-200" />
        </div>
        <GrowthBadge value={memoryOverview.growthRate.monthly} label="先月比" />
      </div>
    </div>
  );
}
