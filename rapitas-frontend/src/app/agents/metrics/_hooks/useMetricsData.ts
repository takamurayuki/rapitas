'use client';
// useMetricsData
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useMetricsData');

export interface AgentMetrics {
  agentId: number;
  agentName: string;
  agentType: string;
  modelId: string | null;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  averageExecutionTimeMs: number | null;
  totalTokensUsed: number;
  averageTokensPerExecution: number | null;
  lastExecutionAt: Date | null;
  isActive: boolean;
}

export interface ExecutionTrendData {
  date: string;
  successful: number;
  failed: number;
  totalTokens: number;
  averageTime: number | null;
}

export interface MetricsOverview {
  totalExecutions: number;
  totalSuccessful: number;
  totalFailed: number;
  overallSuccessRate: number;
  totalTokensUsed: number;
  totalAgents: number;
  activeAgents: number;
  averageExecutionTime: number | null;
}

export interface AgentPerformanceComparison {
  agentType: string;
  modelId: string;
  executionCount: number;
  averageTime: number | null;
  successRate: number;
  totalTokens: number;
}

export interface DateRange {
  startDate: string;
  endDate: string;
  period: 'day' | 'week' | 'month';
}

/** One day of busy ratios (0..1) from /agent-metrics/utilization. */
export interface UtilizationDailyPoint {
  date: string;
  byRole: Record<string, number>;
  byAgent: Record<string, number>;
}

export interface AgentUtilization {
  startDate: string;
  endDate: string;
  dayCount: number;
  daily: UtilizationDailyPoint[];
  roles: Array<{ role: string; utilization: number }>;
  agents: Array<{ agent: string; utilization: number }>;
}

/**
 * Fetches all metrics data in parallel and manages date range filter state.
 *
 * @returns Metrics data, loading/error state, filter state, and export utility
 */
export function useMetricsData() {
  const t = useTranslations('agents');

  const [overview, setOverview] = useState<MetricsOverview | null>(null);
  const [agentMetrics, setAgentMetrics] = useState<AgentMetrics[]>([]);
  const [executionTrends, setExecutionTrends] = useState<ExecutionTrendData[]>([]);
  const [performanceComparison, setPerformanceComparison] = useState<AgentPerformanceComparison[]>(
    [],
  );
  const [utilization, setUtilization] = useState<AgentUtilization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // NOTE: Default window is the trailing 7 days incl. today (task #581 spec) —
  // start = today − 6 so the utilization chart pre-seeds exactly 7 UTC days.
  const [dateRange, setDateRange] = useState<DateRange>({
    startDate: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    period: 'day',
  });
  const [trendDays, setTrendDays] = useState(7);

  const fetchMetricsData = async () => {
    try {
      setLoading(true);
      setError(null);

      const queryParams = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        period: dateRange.period,
      });

      const [overviewRes, agentMetricsRes, trendsRes, performanceRes, utilizationRes] =
        await Promise.all([
          fetch(`${API_BASE_URL}/agent-metrics/overview?${queryParams}`),
          fetch(`${API_BASE_URL}/agent-metrics?${queryParams}`),
          fetch(
            `${API_BASE_URL}/agent-metrics/trends?period=${dateRange.period}&days=${trendDays}`,
          ),
          fetch(`${API_BASE_URL}/agent-metrics/performance?${queryParams}`),
          fetch(`${API_BASE_URL}/agent-metrics/utilization?${queryParams}`),
        ]);

      if (overviewRes.ok) {
        const data = await overviewRes.json();
        setOverview(data);
      }

      if (agentMetricsRes.ok) {
        const data = await agentMetricsRes.json();
        setAgentMetrics(data.metrics || []);
      }

      if (trendsRes.ok) {
        const data = await trendsRes.json();
        setExecutionTrends(data.trends || []);
      }

      if (performanceRes.ok) {
        const data = await performanceRes.json();
        setPerformanceComparison(data.performance || []);
      }

      if (utilizationRes.ok) {
        const data = await utilizationRes.json();
        // The endpoint returns { error } on failure; reset to null then so the
        // cards fall back to their empty state instead of stale data.
        setUtilization(data && !('error' in data) ? data : null);
      }
    } catch (err) {
      logger.error('Failed to fetch metrics data:', err);
      setError(t('metricsFetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetricsData();
    // NOTE: fetchMetricsData depends on dateRange and trendDays; effect runs when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, trendDays]);

  /**
   * Exports all current metrics data to a JSON file download.
   */
  const exportData = () => {
    const data = {
      overview,
      agentMetrics,
      executionTrends,
      performanceComparison,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-metrics-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return {
    overview,
    agentMetrics,
    executionTrends,
    performanceComparison,
    utilization,
    loading,
    error,
    setError,
    dateRange,
    setDateRange,
    trendDays,
    setTrendDays,
    exportData,
    /** Manual refresh — re-fetches all metrics with the current filters. */
    refetch: fetchMetricsData,
  };
}
