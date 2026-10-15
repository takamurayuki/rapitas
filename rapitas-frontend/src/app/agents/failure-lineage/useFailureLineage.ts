'use client';
// use-failure-lineage

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { FailureLineageData } from './types';
import { DEFAULT_HOURS } from './failure-lineage.utils';

const logger = createLogger('useFailureLineage');

export interface UseFailureLineageReturn {
  data: FailureLineageData | null;
  loading: boolean;
  error: string | null;
  hours: number;
  setHours: (hours: number) => void;
  refetch: () => Promise<void>;
}

/**
 * Fetches the estimated failure lineage from GET /agents/failure-lineage and
 * refetches when the window changes.
 *
 * @returns Data, loading/error flags, window state and a manual refetch / 系譜図データと状態
 */
export function useFailureLineage(): UseFailureLineageReturn {
  const tc = useTranslations('common');
  const [data, setData] = useState<FailureLineageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState<number>(DEFAULT_HOURS);

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE_URL}/agents/failure-lineage?hours=${hours}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { success: boolean } & Partial<FailureLineageData>;
      if (body.success && Array.isArray(body.nodes) && Array.isArray(body.edges)) {
        setData(body as FailureLineageData);
      } else {
        setData(null);
        setError(tc('errorOccurred'));
      }
    } catch (err) {
      logger.error('Failed to fetch failure lineage:', err);
      setData(null);
      setError(tc('errorOccurred'));
    } finally {
      setLoading(false);
    }
  }, [hours, tc]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, hours, setHours, refetch };
}
