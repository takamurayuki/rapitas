'use client';
// GoalList

import { useTranslations } from 'next-intl';
import { ChevronRight, CheckCircle2, Target } from 'lucide-react';
import type { LearningGoal } from '@/types';
import { formatDate } from '@/utils/date';
import { EmptyState } from '@/components/ui/empty-state';

type Props = {
  /** The list of goals to display. */
  goals: LearningGoal[];
  /** The currently selected goal, or null if none. */
  selectedGoalId: number | null;
  /** Whether the wizard is open (hides empty-state when true). */
  showWizard: boolean;
  /** Called when a goal row is clicked. */
  onSelect: (goal: LearningGoal) => void;
};

/**
 * Sidebar list of learning goals with status badges.
 *
 * @param props - goals, selectedGoalId, showWizard, onSelect
 */
export function GoalList({ goals, selectedGoalId, showWizard, onSelect }: Props) {
  const t = useTranslations('learning');

  if (goals.length === 0) {
    return showWizard ? null : (
      <EmptyState
        icon={Target}
        title={t('noGoalsYet')}
        description={t('startFromNewGoal')}
        className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700"
      />
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
      <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-3">
        {t('goalList')}
      </h2>
      <div className="space-y-2">
        {goals.map((goal) => (
          <button
            key={goal.id}
            onClick={() => onSelect(goal)}
            className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-colors ${
              selectedGoalId === goal.id
                ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-300 dark:border-emerald-700'
                : 'bg-zinc-50 dark:bg-zinc-700/50 hover:bg-zinc-100 dark:hover:bg-zinc-700'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-zinc-800 dark:text-zinc-200 text-sm truncate">
                  {goal.title}
                </span>
                {goal.isApplied && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full ${
                    goal.status === 'active'
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                      : goal.status === 'completed'
                        ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                        : 'bg-zinc-100 dark:bg-zinc-600 text-zinc-600 dark:text-zinc-300'
                  }`}
                >
                  {goal.status === 'active'
                    ? t('statusActive')
                    : goal.status === 'completed'
                      ? t('statusCompleted')
                      : t('statusArchived')}
                </span>
                {goal.deadline && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    〜{formatDate(goal.deadline)}
                  </span>
                )}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0 ml-2" />
          </button>
        ))}
      </div>
    </div>
  );
}
