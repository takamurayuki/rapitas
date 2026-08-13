'use client';
// use-growth-ledger-data

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { GrowthLedger } from './types';

const logger = createLogger('useGrowthLedgerData');

export interface UseGrowthLedgerDataReturn {
  ledger: GrowthLedger | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches the weekly self-growth ledger from /agent-metrics/growth-ledger.
 *
 * @returns Ledger data plus loading/error state.
 */
export function useGrowthLedgerData(): UseGrowthLedgerDataReturn {
  const tc = useTranslations('common');
  const [ledger, setLedger] = useState<GrowthLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLedger = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE_URL}/agent-metrics/growth-ledger`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { success: boolean; data?: GrowthLedger };
      if (body.success && body.data) {
        setLedger(body.data);
      } else {
        setError(tc('errorOccurred'));
      }
    } catch (err) {
      logger.error('Failed to fetch growth ledger:', err);
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
