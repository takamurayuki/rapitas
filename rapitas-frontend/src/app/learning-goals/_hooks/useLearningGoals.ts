/**
 * useLearningGoals
 *
 * Manages all server-state and mutation logic for the learning goals page.
 * Does not own any UI rendering; delegates display to page components.
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { LearningGoal, Category } from '@/types';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useLearningGoals');

export type GoalFormData = {
  title: string;
  description: string;
  currentLevel: string;
  targetLevel: string;
  deadline: string;
  dailyHours: number;
  categoryId: number | undefined;
};

export const INITIAL_FORM_DATA: GoalFormData = {
  title: '',
  description: '',
  currentLevel: '',
  targetLevel: '',
  deadline: '',
  dailyHours: 2,
  categoryId: undefined,
};

/**
 * Central hook for learning-goals page data and mutations.
 *
 * @returns All state and handlers needed by the learning goals page tree.
 */
export function useLearningGoals() {
  const t = useTranslations('learning');
  const tc = useTranslations('common');
  const { showToast } = useToast();

  const [goals, setGoals] = useState<LearningGoal[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [adapting, setAdapting] = useState(false);
  const [goalProgress, setGoalProgress] = useState<
    Record<number, { total: number; completed: number; rate: number }>
  >({});
  const [selectedGoal, setSelectedGoal] = useState<LearningGoal | null>(null);

  const fetchGoals = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/learning-goals`);
      if (res.ok) {
        setGoals(await res.json());
      }
    } catch (e) {
      logger.error('Failed to fetch learning goals:', e);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/categories`);
      if (res.ok) {
        const data = await res.json();
        setCategories(
          data.filter(
            (c: Category) => c.mode === 'learning' || c.mode === 'both',
          ),
        );
      }
    } catch (e) {
      logger.error('Failed to fetch categories:', e);
    }
  }, []);

  const fetchGoalProgress = useCallback(async (goalList: LearningGoal[]) => {
    const appliedGoals = goalList.filter((g) => g.isApplied && g.themeId);
    const progressMap: Record<
      number,
      { total: number; completed: number; rate: number }
    > = {};

    for (const goal of appliedGoals) {
      try {
        const res = await fetch(
          `${API_BASE_URL}/tasks?themeId=${goal.themeId}`,
        );
        if (res.ok) {
          const data = await res.json();
          const tasks = Array.isArray(data) ? data : data.tasks || [];
          const parentTasks = tasks.filter(
            (t: { parentId: number | null }) => !t.parentId,
          );
          const total = parentTasks.length;
          const completed = parentTasks.filter(
            (t: { status: string }) => t.status === 'done',
          ).length;
          progressMap[goal.id] = {
            total,
            completed,
            rate: total > 0 ? completed / total : 0,
          };
        }
      } catch (e) {
        logger.error(`Failed to fetch progress for goal ${goal.id}:`, e);
      }
    }
    setGoalProgress(progressMap);
  }, []);

  useEffect(() => {
    Promise.all([fetchGoals(), fetchCategories()]).finally(() =>
      setLoading(false),
    );
  }, [fetchGoals, fetchCategories]);

  useEffect(() => {
    if (goals.length > 0) {
      fetchGoalProgress(goals);
    }
  }, [goals, fetchGoalProgress]);

  /**
   * Triggers AI adaptation of a goal's plan based on current progress.
   *
   * @param goal - The goal to adapt.
   */
  const handleAdaptPlan = async (goal: LearningGoal) => {
    setAdapting(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/learning-goals/${goal.id}/adapt`,
        {
          method: 'POST',
        },
      );
      if (res.ok) {
        const result = await res.json();
        if (result.success) {
          showToast(t('adaptSuccess'), 'success');
          await fetchGoals();
          const updated = await fetch(
            `${API_BASE_URL}/learning-goals/${goal.id}`,
          );
          if (updated.ok) setSelectedGoal(await updated.json());
        } else {
          showToast(result.error || t('adaptFailed'), 'error');
        }
      }
    } catch (e) {
      logger.error('Failed to adapt plan:', e);
      showToast(tc('errorOccurred'), 'error');
    } finally {
      setAdapting(false);
    }
  };

  /**
   * Creates a new learning goal and immediately triggers plan generation.
   *
   * @param formData - Wizard form values.
   * @param onSuccess - Called after creation so the wizard can reset.
   */
  const handleCreateGoal = async (
    formData: GoalFormData,
    onSuccess: () => void,
  ) => {
    if (!formData.title.trim()) return;
    try {
      const res = await fetch(`${API_BASE_URL}/learning-goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formData.title,
          description: formData.description || undefined,
          currentLevel: formData.currentLevel || undefined,
          targetLevel: formData.targetLevel || undefined,
          deadline: formData.deadline || undefined,
          dailyHours: formData.dailyHours,
          categoryId: formData.categoryId,
        }),
      });
      if (res.ok) {
        const newGoal = await res.json();
        showToast(t('goalCreated'), 'success');
        onSuccess();
        await fetchGoals();
        // NOTE: Auto-start plan generation after creation per product requirement.
        handleGeneratePlan(newGoal.id);
      }
    } catch (e) {
      logger.error('Failed to create learning goal:', e);
      showToast(t('createFailed'), 'error');
    }
  };

  /**
   * Requests AI plan generation for the given goal id.
   *
   * @param goalId - Target goal.
   */
  const handleGeneratePlan = async (goalId: number) => {
    setGenerating(true);
    const targetGoal = goals.find((g) => g.id === goalId);
    if (targetGoal) setSelectedGoal(targetGoal);

    try {
      const res = await fetch(
        `${API_BASE_URL}/learning-goals/${goalId}/generate-plan`,
        { method: 'POST' },
      );
      if (res.ok) {
        const result = await res.json();
        showToast(
          result.source === 'ai' ? t('aiGeneratedPlan') : t('planGenerated'),
          'success',
        );
        await fetchGoals();
        const updated = await fetch(`${API_BASE_URL}/learning-goals/${goalId}`);
        if (updated.ok) setSelectedGoal(await updated.json());
      } else {
        showToast(t('planGenerateFailed'), 'error');
      }
    } catch (e) {
      logger.error('Failed to generate plan:', e);
      showToast(tc('errorOccurred'), 'error');
    } finally {
      setGenerating(false);
    }
  };

  /**
   * Applies a generated plan by creating tasks in the task system.
   *
   * @param goal - The goal whose plan should be applied.
   */
  const handleApplyPlan = async (goal: LearningGoal) => {
    if (goal.isApplied) {
      showToast(t('alreadyApplied'), 'info');
      return;
    }
    if (!confirm(t('applyConfirm'))) return;

    setApplying(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/learning-goals/${goal.id}/apply`,
        {
          method: 'POST',
        },
      );
      if (res.ok) {
        const result = await res.json();
        if (result.success) {
          showToast(
            t('tasksCreated', {
              count: result.createdTaskCount,
              theme: result.themeName,
            }),
            'success',
          );
          await fetchGoals();
          const updated = await fetch(
            `${API_BASE_URL}/learning-goals/${goal.id}`,
          );
          if (updated.ok) setSelectedGoal(await updated.json());
        } else {
          showToast(result.error || t('applyFailed'), 'error');
        }
      }
    } catch (e) {
      logger.error('Failed to apply plan:', e);
      showToast(tc('errorOccurred'), 'error');
    } finally {
      setApplying(false);
    }
  };

  /**
   * Deletes a learning goal by id.
   *
   * @param id - Goal id to delete.
   */
  const handleDelete = async (id: number) => {
    if (!confirm(t('deleteConfirm'))) return;
    try {
      const res = await fetch(`${API_BASE_URL}/learning-goals/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        showToast(t('goalDeleted'), 'success');
        if (selectedGoal?.id === id) setSelectedGoal(null);
        await fetchGoals();
      }
    } catch (e) {
      logger.error('Failed to delete:', e);
      showToast(t('deleteFailed'), 'error');
    }
  };

  return {
    goals,
    categories,
    loading,
    generating,
    applying,
    adapting,
    goalProgress,
    selectedGoal,
    setSelectedGoal,
    handleAdaptPlan,
    handleCreateGoal,
    handleGeneratePlan,
    handleApplyPlan,
    handleDelete,
  };
}
