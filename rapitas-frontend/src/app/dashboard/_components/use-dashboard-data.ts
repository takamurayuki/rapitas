/**
 * use-dashboard-data
 *
 * Data-fetching hook for the dashboard page: overview statistics. Rendering is
 * owned by the page and its _components.
 */
'use client';
import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DashboardPage');

export type OverviewStats = {
  tasks: {
    total: number;
    completed: number;
    todayCompleted: number;
    weekCompleted: number;
    completionRate: number;
  };
};

/**
 * Fetch the dashboard overview statistics.
 *
 * @returns Overview stats and a loading flag. / 概要統計とローディングフラグ。
 */
export function useDashboardData() {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/statistics/overview`);
      if (res.ok) {
        setOverview(await res.json());
      }
    } catch (e) {
      logger.transientError('Failed to fetch overview:', e);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      await fetchOverview();
      setLoading(false);
    };

    loadData();
  }, [fetchOverview]);

  return { overview, loading };
}
