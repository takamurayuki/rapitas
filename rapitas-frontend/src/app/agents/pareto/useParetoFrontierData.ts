'use client';
// use-pareto-frontier-data

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { ParetoFrontierResult, ParetoQueryFilters } from './types';
import { DEFAULT_WINDOW_DAYS, buildParetoQuery } from './pareto.utils';

const logger = createLogger('useParetoFrontierData');

export interface UseParetoFrontierDataReturn {
  frontier: ParetoFrontierResult | null;
  loading: boolean;
  error: string | null;
  filters: ParetoQueryFilters;
  setFilters: (updater: (prev: ParetoQueryFilters) => ParetoQueryFilters) => void;
}

/**
 * Fetches the per-segment Pareto frontier from /agent-metrics/pareto-frontier
 * and refetches whenever the window/complexity/role filters change.
 *
 * @returns Frontier data plus filter state and loading/error flags.
 */
export function useParetoFrontierData(): UseParetoFrontierDataReturn {
  const tc = useTranslations('common');
  const [frontier, setFrontier] = useState<ParetoFrontierResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFiltersState] = useState<ParetoQueryFilters>({
    days: DEFAULT_WINDOW_DAYS,
    complexityBand: 'all',
    role: 'all',
  });

  const setFilters = useCallback(
    (updater: (prev: ParetoQueryFilters) => ParetoQueryFilters) => setFiltersState(updater),
    [],
  );

  const fetchFrontier = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(
        `${API_BASE_URL}/agent-metrics/pareto-frontier?${buildParetoQuery(filters)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { success: boolean; data?: ParetoFrontierResult };
      if (body.success && body.data) {
        setFrontier(body.data);
      } else {
        setError(tc('errorOccurred'));
      }
    } catch (err) {
      logger.error('Failed to fetch pareto frontier:', err);
      setError(tc('errorOccurred'));
    } finally {
      setLoading(false);
    }
  }, [filters, tc]);

  useEffect(() => {
    fetchFrontier();
  }, [fetchFrontier]);

  return { frontier, loading, error, filters, setFilters };
}
