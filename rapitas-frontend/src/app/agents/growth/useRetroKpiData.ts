'use client';
// use-retro-kpi-data

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { RetroKpiLedger } from './types';

const logger = createLogger('useRetroKpiData');

export interface UseRetroKpiDataReturn {
  ledger: RetroKpiLedger | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches the weekly self-improvement KPI ledger from /agent-metrics/retro-kpi
 * (API defaults: 7-day windows, 8 weeks — the supervisor baseline layout).
 *
 * @returns Ledger data plus loading/error state.
 */
export function useRetroKpiData(): UseRetroKpiDataReturn {
  const tc = useTranslations('common');
  const [ledger, setLedger] = useState<RetroKpiLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLedger = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE_URL}/agent-metrics/retro-kpi`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { success: boolean; data?: RetroKpiLedger };
      if (body.success && body.data) {
        setLedger(body.data);
      } else {
        setError(tc('errorOccurred'));
      }
    } catch (err) {
      logger.error('Failed to fetch retro kpi ledger:', err);
      setError(tc('errorOccurred'));
    } finally {
      setLoading(false);
    }
  }, [tc]);

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

  return { ledger, loading, error };
}
