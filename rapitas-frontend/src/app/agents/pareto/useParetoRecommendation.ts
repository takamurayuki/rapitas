'use client';
// use-pareto-recommendation

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { ParetoGoal, ParetoQueryFilters, ParetoRecommendationResult } from './types';
import { buildParetoQuery } from './pareto.utils';

const logger = createLogger('useParetoRecommendation');

export interface UseParetoRecommendationReturn {
  result: ParetoRecommendationResult | null;
  loading: boolean;
  error: string | null;
  /** Runs the what-if query for `goal` under the current filters. */
  recommend: (goal: ParetoGoal) => Promise<void>;
  reset: () => void;
}

/**
 * On-demand what-if query against /agent-metrics/pareto-frontier/recommend.
 * Unlike the frontier hook it does not auto-fetch: the user submits a goal.
 *
 * @param filters - Window/complexity/role filters shared with the frontier.
 * @returns Latest recommendation plus the submit callback and state flags.
 */
export function useParetoRecommendation(
  filters: ParetoQueryFilters,
): UseParetoRecommendationReturn {
  const tc = useTranslations('common');
  const [result, setResult] = useState<ParetoRecommendationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recommend = useCallback(
    async (goal: ParetoGoal) => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          `${API_BASE_URL}/agent-metrics/pareto-frontier/recommend?${buildParetoQuery(filters, goal)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as {
          success: boolean;
          data?: ParetoRecommendationResult;
        };
        if (body.success && body.data) {
          setResult(body.data);
        } else {
          setError(tc('errorOccurred'));
        }
      } catch (err) {
        logger.error('Failed to fetch pareto recommendation:', err);
        setError(tc('errorOccurred'));
      } finally {
        setLoading(false);
      }
    },
    [filters, tc],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, loading, error, recommend, reset };
}
