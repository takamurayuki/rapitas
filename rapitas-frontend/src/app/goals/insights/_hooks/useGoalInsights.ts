'use client';
/**
 * useGoalInsights
 *
 * Loads GET /goal-insights for the chosen period. Not responsible for
 * any calculation — the backend returns finished rates and counts.
 */
import { useEffect, useState } from 'react';
import { apiErrorMessage, goalsApi } from '../../_hooks/goals-api';
import type { InsightPeriod, InsightsResponse } from './insights.types';

/**
 * Load the metrics and expose the period switch.
 *
 * @returns The response, loading/error state and the period control / 指標と期間の操作
 */
export function useGoalInsights() {
  const [period, setPeriod] = useState<InsightPeriod>('4w');
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A stale answer for a previous period must not overwrite the current one.
    let current = true;
    setIsLoading(true);
    goalsApi
      .insights(period)
      .then((res) => {
        if (!current) return;
        setData(res);
        setError(null);
      })
      .catch((err) => {
        if (current) {
          setError(apiErrorMessage(err) ?? (err instanceof Error ? err.message : String(err)));
        }
      })
      .finally(() => {
        if (current) setIsLoading(false);
      });
    return () => {
      current = false;
    };
  }, [period]);

  return { data, isLoading, error, period, setPeriod };
}
