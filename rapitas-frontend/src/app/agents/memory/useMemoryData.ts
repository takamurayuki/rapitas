'use client';
// use-memory-data

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { MemoryOverview, GrowthTimeline } from './types';

const logger = createLogger('useMemoryData');

export interface UseMemoryDataReturn {
  memoryOverview: MemoryOverview | null;
  growthTimeline: GrowthTimeline | null;
  selectedPeriod: '7d' | '30d' | 'all';
  loading: boolean;
  error: string | null;
  setSelectedPeriod: (p: '7d' | '30d' | 'all') => void;
  formatDate: (dateString: string) => string;
  formatChartDate: (dateString: string) => string;
}

/**
 * Fetches memory overview and growth timeline data from the backend.
 * Re-fetches automatically when the selected time period changes.
 *
 * @returns Data, loading/error state, period selector, and date formatters.
 */
export function useMemoryData(): UseMemoryDataReturn {
  const tc = useTranslations('common');

  const [memoryOverview, setMemoryOverview] = useState<MemoryOverview | null>(
    null,
  );
  const [growthTimeline, setGrowthTimeline] = useState<GrowthTimeline | null>(
    null,
  );
  const [selectedPeriod, setSelectedPeriod] = useState<'7d' | '30d' | 'all'>(
    '30d',
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMemoryData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [overviewRes, timelineRes] = await Promise.all([
        fetch(`${API_BASE_URL}/learning/memory-overview`),
        fetch(
          `${API_BASE_URL}/learning/growth-timeline?period=${selectedPeriod}`,
        ),
      ]);
      if (overviewRes.ok) setMemoryOverview(await overviewRes.json());
      if (timelineRes.ok) setGrowthTimeline(await timelineRes.json());
      if (!overviewRes.ok && !timelineRes.ok) setError(tc('errorOccurred'));
    } catch (err) {
      logger.error('Failed to fetch memory data:', err);
      setError(tc('errorOccurred'));
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, tc]);

  useEffect(() => {
    fetchMemoryData();
  }, [fetchMemoryData]);

  /**
   * Formats an ISO date string into a localised date-time label (ja-JP).
   *
   * @param dateString - ISO 8601 date string.
   * @returns Localised string, e.g. "3月20日 14:05".
   */
  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  /**
   * Formats an ISO date string into a short M/D label for chart axes.
   *
   * @param dateString - ISO 8601 date string.
   * @returns Short label, e.g. "3/20".
   */
  const formatChartDate = (dateString: string) => {
    const d = new Date(dateString);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return {
    memoryOverview,
    growthTimeline,
    selectedPeriod,
    loading,
    error,
    setSelectedPeriod,
    formatDate,
    formatChartDate,
  };
}
