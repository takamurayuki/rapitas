/**
 * アナリティクスダッシュボード用カスタムフック
 * 日付範囲に応じた分析データの取得を提供する
 */

import { useState, useCallback, useEffect } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useAnalyticsDashboard');

export interface DateRange {
  from: string; // ISO date string (YYYY-MM-DD)
  to: string;
}

export interface AnalyticsData {
  totalTasks: number;
  completedTasks: number;
  totalTimeMinutes: number;
  completionRate: number;
  dailyStats: Array<{ date: string; completed: number; created: number }>;
  categoryBreakdown: Array<{ categoryId: number; name: string; count: number }>;
}

function getDefaultDateRange(): DateRange {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().split('T')[0]!,
    to: to.toISOString().split('T')[0]!,
  };
}

export function useAnalyticsDashboard(initialRange?: DateRange) {
  const [dateRange, setDateRange] = useState<DateRange>(initialRange ?? getDefaultDateRange());
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchAnalytics = useCallback(async (range: DateRange) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      const res = await fetch(`${API_BASE_URL}/analytics/dashboard?${params}`);
      if (!res.ok) throw new Error(`Failed to fetch analytics: ${res.status}`);
      const result = await res.json();
      setData(result);
    } catch (error) {
      logger.error('Failed to fetch analytics data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics(dateRange);
  }, [dateRange, fetchAnalytics]);

  const updateDateRange = useCallback((range: DateRange) => {
    setDateRange(range);
  }, []);

  return { data, isLoading, dateRange, setDateRange: updateDateRange };
}
