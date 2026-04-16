'use client';
// useWeeklyReview
import useSWR from 'swr';
import { useCallback, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type {
  WeeklyReview,
  WeeklyReviewSingleResponse,
} from '@/types/weekly-review.types';

const fetcher = async (url: string): Promise<WeeklyReview | null> => {
  const res = await fetch(`${API_BASE_URL}${url}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch weekly review: ${res.statusText}`);
  }
  const body = (await res.json()) as WeeklyReviewSingleResponse;
  return body.review;
};

export interface UseWeeklyReviewReturn {
  review: WeeklyReview | null | undefined;
  isLoading: boolean;
  error: Error | undefined;
  isRegenerating: boolean;
  regenerateError: string | null;
  /** Trigger backend generation. Optionally specify a week start (ISO date). */
  regenerate: (weekStart?: string) => Promise<WeeklyReview | null>;
}

/**
 * @returns Latest weekly review and a regenerate action.
 */
export function useWeeklyReview(): UseWeeklyReviewReturn {
  const { data, error, isLoading, mutate } = useSWR<WeeklyReview | null>(
    '/weekly-reviews/latest',
    fetcher,
  );
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  const regenerate = useCallback(
    async (weekStart?: string): Promise<WeeklyReview | null> => {
      setIsRegenerating(true);
      setRegenerateError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/weekly-reviews/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(weekStart ? { weekStart } : {}),
        });
        const body = (await res.json()) as WeeklyReviewSingleResponse;
        if (!res.ok || !body.success) {
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        await mutate();
        return body.review;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Regeneration failed';
        setRegenerateError(message);
        return null;
      } finally {
        setIsRegenerating(false);
      }
    },
    [mutate],
  );

  return {
    review: data,
    isLoading,
    error,
    isRegenerating,
    regenerateError,
    regenerate,
  };
}
