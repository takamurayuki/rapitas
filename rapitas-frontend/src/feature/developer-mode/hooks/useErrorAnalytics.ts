/**
 * useErrorAnalytics
 *
 * Fetches categorised error analytics from the backend daily log aggregator.
 * Returns loading / error states plus a `refresh` callback.
 * Does NOT poll automatically — the caller decides when to refresh.
 */

import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';

export interface CategoryStats {
  name: string;
  label: string;
  totalCount: number;
  sharePercent: number;
  currentWeek: number;
  previousWeek: number;
  deltaCount: number;
  deltaPercent: number | null;
  topMessages: { msg: string; count: number }[];
}

export interface DailyTrendEntry {
  date: string;
  counts: Record<string, number>;
}

export interface ErrorAnalyticsData {
  categories: CategoryStats[];
  total: {
    count: number;
    currentWeek: number;
    previousWeek: number;
    deltaCount: number;
    deltaPercent: number | null;
  };
  dailyTrend: DailyTrendEntry[];
  availableDays: number;
  unclassified: number;
}

interface UseErrorAnalyticsResult {
  data: ErrorAnalyticsData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetches error analytics from /system/monitoring/error-analytics.
 *
 * @param days - Number of past days to include (default 14) / 集計日数
 * @returns Data, loading state, error, and refresh callback
 */
export function useErrorAnalytics(days = 14): UseErrorAnalyticsResult {
  const [data, setData] = useState<ErrorAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/system/monitoring/error-analytics?days=${days}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { success: boolean; data?: ErrorAnalyticsData; error?: string };
      if (!json.success || !json.data) throw new Error(json.error ?? 'Unknown error');
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
