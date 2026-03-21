/**
 * AgentMemoryPage
 *
 * Analytics page visualising the AI agent's accumulated knowledge and learning
 * patterns. Delegates data fetching to useMemoryData and rendering to focused
 * sub-components.
 */

'use client';

import { AlertTriangle, Brain } from 'lucide-react';
import { useMemoryData } from './useMemoryData';
import { MemoryStrengthCard } from './components/MemoryStrengthCard';
import { OverviewCards } from './components/OverviewCards';
import { GrowthTrendChart } from './components/GrowthTrendChart';
import { ConfidenceTrendChart } from './components/ConfidenceTrendChart';
import { RecentLearnings } from './components/RecentLearnings';

/** Skeleton loader shown while the initial data fetch is in-flight. */
function PageSkeleton() {
  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded w-64" />
          <div className="h-40 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-32 bg-zinc-200 dark:bg-zinc-700 rounded-xl"
              />
            ))}
          </div>
          <div className="h-80 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export default function AgentMemoryPage() {
  const {
    memoryOverview,
    growthTimeline,
    selectedPeriod,
    loading,
    error,
    setSelectedPeriod,
    formatDate,
    formatChartDate,
  } = useMemoryData();

  if (loading) return <PageSkeleton />;

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-lg">
              <Brain className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              エージェントの記憶
            </h1>
          </div>
          <p className="text-zinc-500 dark:text-zinc-400">
            AIエージェントが蓄積した知識と学習パターンの成長を可視化します
          </p>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {memoryOverview && (
          <>
            <MemoryStrengthCard memoryOverview={memoryOverview} />
            <OverviewCards memoryOverview={memoryOverview} />
          </>
        )}

        <GrowthTrendChart
          growthTimeline={growthTimeline}
          memoryOverview={memoryOverview}
          selectedPeriod={selectedPeriod}
          onPeriodChange={setSelectedPeriod}
          formatChartDate={formatChartDate}
        />

        {growthTimeline && growthTimeline.timeline.length > 0 && (
          <ConfidenceTrendChart
            growthTimeline={growthTimeline}
            formatChartDate={formatChartDate}
          />
        )}

        {memoryOverview && (
          <RecentLearnings
            memoryOverview={memoryOverview}
            formatDate={formatDate}
          />
        )}

        {/* Empty state — no data and no error */}
        {!memoryOverview && !loading && !error && (
          <div className="text-center py-16">
            <Brain className="w-16 h-16 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-zinc-600 dark:text-zinc-400 mb-2">
              記憶データがありません
            </h2>
            <p className="text-zinc-500 dark:text-zinc-400">
              エージェントがタスクを実行すると、ここに学習の成長が表示されます
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
