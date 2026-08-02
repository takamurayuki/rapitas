/**
 * useStudyGoals
 *
 * Roadmap view model: unified goal list with CRUD against /study-goals.
 */
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { useToast } from '@/components/ui/toast/ToastContainer';
import type { StudyGoal, StudyGoalDraft, StudyGoalStatus } from './roadmap.types';

/** Serialize a draft for the API (empty strings become null). */
function draftPayload(draft: StudyGoalDraft): Record<string, unknown> {
  const opt = (v: string) => (v.trim() ? v.trim() : null);
  return {
    type: draft.type,
    title: draft.title.trim(),
    description: opt(draft.description),
    deadline: opt(draft.deadline),
    dailyMinutes: draft.dailyMinutes,
    color: draft.color,
    ...(draft.type === 'skill'
      ? { currentLevel: opt(draft.currentLevel), targetLevel: opt(draft.targetLevel) }
      : { targetScore: opt(draft.targetScore), actualScore: opt(draft.actualScore) }),
  };
}

/**
 * Provide the unified goal list and mutations.
 *
 * @returns Goals, loading state, and CRUD handlers. / 目標一覧と操作。
 */
export function useStudyGoals() {
  const t = useTranslations('learningRoadmap');
  const { showToast } = useToast();
  const [goals, setGoals] = useState<StudyGoal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchGoals = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/study-goals`);
      if (res.ok) setGoals((await res.json()) as StudyGoal[]);
    } catch {
      /* non-critical */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  const createGoal = useCallback(
    async (draft: StudyGoalDraft) => {
      try {
        const res = await fetch(`${API_BASE_URL}/study-goals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draftPayload(draft)),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchGoals();
        return true;
      } catch {
        showToast(t('messages.saveFailed'), 'error');
        return false;
      }
    },
    [fetchGoals, showToast, t],
  );

  const updateGoal = useCallback(
    async (id: number, patch: Partial<StudyGoalDraft> & { status?: StudyGoalStatus }) => {
      try {
        const body: Record<string, unknown> = { ...patch };
        if (patch.title !== undefined) body.title = patch.title.trim();
        if (patch.deadline !== undefined) body.deadline = patch.deadline.trim() || null;
        const res = await fetch(`${API_BASE_URL}/study-goals/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchGoals();
        return true;
      } catch {
        showToast(t('messages.saveFailed'), 'error');
        return false;
      }
    },
    [fetchGoals, showToast, t],
  );

  const deleteGoal = useCallback(
    async (id: number) => {
      try {
        const res = await fetch(`${API_BASE_URL}/study-goals/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setGoals((prev) => prev.filter((g) => g.id !== id));
      } catch {
        showToast(t('messages.deleteFailed'), 'error');
      }
    },
    [showToast, t],
  );

  return { goals, isLoading, fetchGoals, createGoal, updateGoal, deleteGoal };
}
