'use client';
/**
 * useGoals
 *
 * The goal list: loads GET /goals and creates a goal. Not responsible for
 * one goal's milestones (useGoalDetail).
 */
import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage, goalsApi } from './goals-api';
import type { GoalSummary } from './goals.types';

/**
 * Load the goal list and expose goal creation.
 *
 * @returns The goals, loading/error state and actions / ゴール一覧と操作
 */
export function useGoals() {
  const [goals, setGoals] = useState<GoalSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setGoals(await goalsApi.list());
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err) ?? (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Create a goal; resolves to its id so the caller can open it. */
  const createGoal = useCallback(
    async (name: string, description: string): Promise<number> => {
      const created = await goalsApi.createGoal(name, description);
      await reload();
      return created.id;
    },
    [reload],
  );

  return { goals, isLoading, error, reload, createGoal };
}
