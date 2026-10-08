'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { CorrelationCell, FailureDrilldownEntry } from '../test-correlation.types';

const logger = createLogger('useTestCorrelationMatrix');

interface UseTestCorrelationMatrixResult {
  cells: CorrelationCell[];
  loading: boolean;
  error: string | null;
  refetch: (windowMonths?: number) => Promise<void>;
}

/**
 * Fetches the test-failure correlation matrix from the backend.
 *
 * @param windowMonths - Time-series filter window in months (default: 3) / フィルタ窓（月）
 * @returns Cells, loading/error state, and a refetch function / マトリックス取得状態
 */
export function useTestCorrelationMatrix(windowMonths = 3): UseTestCorrelationMatrixResult {
  const [cells, setCells] = useState<CorrelationCell[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(
    async (overrideWindowMonths?: number) => {
      setLoading(true);
      setError(null);
      try {
        const months = overrideWindowMonths ?? windowMonths;
        const res = await globalThis.fetch(
          `${API_BASE_URL}/analytics/test-correlation/matrix?windowMonths=${months}`,
        );
        if (!res.ok) {
          setError('Failed to fetch test correlation matrix');
          return;
        }
        const data = await res.json();
        setCells(data.cells ?? []);
      } catch (e) {
        logger.warn('Failed to fetch test correlation matrix:', e);
        setError('Failed to fetch test correlation matrix');
      } finally {
        setLoading(false);
      }
    },
    [windowMonths],
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { cells, loading, error, refetch };
}

/**
 * Fetches failure drilldown entries for one correlation cell.
 *
 * @param changedFile - Changed-file axis value / 変更ファイル
 * @param testFile - Test-file axis value / テストファイル
 * @param windowMonths - Time-series filter window in months / フィルタ窓（月）
 * @returns Drilldown entries, or [] on failure / 失敗事例一覧
 */
export async function fetchTestCorrelationDrilldown(
  changedFile: string,
  testFile: string,
  windowMonths = 3,
): Promise<FailureDrilldownEntry[]> {
  try {
    const params = new URLSearchParams({
      changedFile,
      testFile,
      windowMonths: String(windowMonths),
    });
    const res = await globalThis.fetch(
      `${API_BASE_URL}/analytics/test-correlation/drilldown?${params.toString()}`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.entries ?? [];
  } catch (e) {
    logger.warn('Failed to fetch test correlation drilldown:', e);
    return [];
  }
}
