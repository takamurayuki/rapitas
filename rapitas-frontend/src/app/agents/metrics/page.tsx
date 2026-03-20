/**
 * AgentMetricsPage
 *
 * Entry point for the /agents/metrics route.
 * Composes filter, overview, chart, and table sub-components.
 * All data fetching is delegated to useMetricsData.
 */
'use client';

import { useTranslations } from 'next-intl';
import { Download, AlertCircle, XCircle } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { requireAuth } from '@/contexts/AuthContext';
import { useMetricsData } from './useMetricsData';
import { MetricsOverviewCards } from './MetricsOverviewCards';
import { MetricsFilters } from './MetricsFilters';
import { MetricsCharts } from './MetricsCharts';
import { MetricsTable } from './MetricsTable';

function AgentMetricsPage() {
  const t = useTranslations('agents');

  const {
    overview,
    agentMetrics,
    executionTrends,
    performanceComparison,
    loading,
    error,
    setError,
    dateRange,
    setDateRange,
    trendDays,
    setTrendDays,
    exportData,
  } = useMetricsData();

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              {t('metricsTitle')}
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400 mt-1">
              {t('metricsDescription')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={exportData}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              {t('dataExport')}
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400 hover:text-red-600 dark:hover:text-red-300"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        )}

        <MetricsFilters
          dateRange={dateRange}
          trendDays={trendDays}
          setDateRange={setDateRange}
          setTrendDays={setTrendDays}
        />

        {overview && <MetricsOverviewCards overview={overview} />}

        <MetricsCharts
          executionTrends={executionTrends}
          performanceComparison={performanceComparison}
        />

        <MetricsTable agentMetrics={agentMetrics} />
      </div>
    </div>
  );
}

export default requireAuth(AgentMetricsPage);
