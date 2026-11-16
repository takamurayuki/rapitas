'use client';
/**
 * useGoalDetail
 *
 * One goal: its milestones (節目), the tasks not filed under one yet, and the
 * milestone actions (add, edit criteria, pause/resume, confirm, reopen,
 * delete). Every action reloads the goal, so the reach rate shown is always
 * the server's — never a client-side guess.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage, goalsApi } from './goals-api';
import type { GoalDetail, UnassignedTask } from './goals.types';

const messageOf = (err: unknown) =>
  apiErrorMessage(err) ?? (err instanceof Error ? err.message : String(err));

/**
 * Load one goal and expose its milestone actions.
 *
 * @param goalId - The goal (project) id / ゴールのID
 * @returns The goal, unassigned tasks, state and actions / ゴールと操作
 */
export function useGoalDetail(goalId: number) {
  const [goal, setGoal] = useState<GoalDetail | null>(null);
  const [unassigned, setUnassigned] = useState<UnassignedTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [detail, tasks] = await Promise.all([
        goalsApi.detail(goalId),
        goalsApi.unassignedTasks(goalId),
      ]);
      setGoal(detail);
      setUnassigned(tasks);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setIsLoading(false);
    }
  }, [goalId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Run an action then reload; a failure is returned as the backend's sentence.
   * Returns null on success.
   */
  const run = useCallback(
    async (action: () => Promise<unknown>): Promise<string | null> => {
      try {
        await action();
        await reload();
        return null;
      } catch (err) {
        return messageOf(err);
      }
    },
    [reload],
  );

  return {
    goal,
    unassigned,
    isLoading,
    error,
    reload,
    addMilestone: (name: string, dueDate: string | null) =>
      run(() => goalsApi.createMilestone(goalId, name, dueDate)),
    saveCriteria: (milestoneId: number, criteria: string[]) =>
      run(() => goalsApi.updateMilestone(milestoneId, { acceptanceCriteria: criteria })),
    setPaused: (milestoneId: number, paused: boolean) =>
      run(() => goalsApi.updateMilestone(milestoneId, { status: paused ? 'paused' : 'open' })),
    confirm: (milestoneId: number, checked: string[], evidence: string) =>
      run(() => goalsApi.confirmMilestone(milestoneId, checked, evidence)),
    reopen: (milestoneId: number) => run(() => goalsApi.reopenMilestone(milestoneId)),
    deleteMilestone: (milestoneId: number) => run(() => goalsApi.deleteMilestone(milestoneId)),
    fileTask: (taskId: number, milestoneId: number) =>
      run(() => goalsApi.fileTask(taskId, milestoneId)),
  };
}

/** What useGoalDetail returns. */
export type GoalDetailModel = ReturnType<typeof useGoalDetail>;
