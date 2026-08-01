/**
 * useVocabAnalytics
 *
 * Fetches the learning-analytics aggregates for the vocabulary book.
 */
'use client';
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type { VocabAnalytics } from './vocab.types';

/**
 * Load the analytics payload once on mount.
 *
 * @returns Analytics data and loading state. / 分析データと読込状態。
 */
export function useVocabAnalytics() {
  const [data, setData] = useState<VocabAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/vocab/analytics`);
        if (res.ok) setData((await res.json()) as VocabAnalytics);
      } catch {
        /* non-critical — page shows the empty state */
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  return { data, isLoading };
}
