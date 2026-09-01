'use client';

/**
 * StudyGoalCard
 *
 * One unified goal on the roadmap: type badge (skill / exam), deadline
 * countdown, linked-task progress, and the type-specific fields (levels or
 * scores). Actions: edit, complete, delete.
 */
import { useTranslations, useFormatter } from 'next-intl';
import { Pencil, Trash2, Check, GraduationCap, Timer, Cable } from 'lucide-react';
import type { StudyGoal } from './roadmap.types';

interface GoalCardProps {
  goal: StudyGoal;
  onEdit: (goal: StudyGoal) => void;
  onComplete: (goal: StudyGoal) => void;
  onDelete: (goal: StudyGoal) => void;
  linkedThemeName: string | null;
  onLinkTheme: (goal: StudyGoal) => void;
}

/**
 * Render one goal card.
 *
 * @param props - Goal, action callbacks, and the linked theme's name (if any). / 目標・操作コールバック・紐づけ済みテーマ名。
 */
export function StudyGoalCard({
  goal,
  onEdit,
  onComplete,
  onDelete,
  linkedThemeName,
  onLinkTheme,
}: GoalCardProps) {
  const t = useTranslations('learningRoadmap');
  const format = useFormatter();

  const daysLeft = goal.deadline
    ? Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / 86_400_000)
    : null;
  const progress =
    goal.taskCount > 0 ? Math.round((goal.doneTaskCount / goal.taskCount) * 100) : null;
  const isDone = goal.status === 'completed';

  return (
    <div
      className={`group rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-indigo-dark-900 ${
        isDone ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ backgroundColor: `${goal.color}26`, color: goal.color }}
            >
              {t(`types.${goal.type}`)}
            </span>
            {linkedThemeName && (
              <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                <Cable className="h-3 w-3" aria-hidden="true" />
                {t('themeLink.linkedBadge', { theme: linkedThemeName })}
              </span>
            )}
            <h2 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {goal.title}
            </h2>
            {isDone && (
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                {t('statusCompleted')}
              </span>
            )}
          </div>
          {goal.description && (
            <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
              {goal.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {!isDone && (
            <button
              onClick={() => onComplete(goal)}
              aria-label={t('complete')}
              title={t('complete')}
              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-green-600 dark:hover:bg-zinc-800"
            >
              <Check className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => onLinkTheme(goal)}
            aria-label={t('themeLink.button')}
            title={t('themeLink.button')}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-indigo-600 dark:hover:bg-zinc-800"
          >
            <Cable className="h-4 w-4" />
          </button>
          <button
            onClick={() => onEdit(goal)}
            aria-label={t('edit')}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(goal)}
            aria-label={t('delete')}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-600 dark:text-zinc-400">
        {goal.deadline && (
          <span
            className={
              daysLeft != null && daysLeft <= 14 && !isDone
                ? 'font-medium text-amber-600 dark:text-amber-400'
                : ''
            }
          >
            {format.dateTime(new Date(goal.deadline), { dateStyle: 'medium' })}
            {daysLeft != null && !isDone && (
              <span className="ml-1">
                {daysLeft >= 0 ? t('daysLeft', { days: daysLeft }) : t('overdue')}
              </span>
            )}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Timer className="h-3.5 w-3.5" aria-hidden="true" />
          {t('dailyQuota', { min: goal.dailyMinutes })}
        </span>
        {goal.type === 'skill' && (goal.currentLevel || goal.targetLevel) && (
          <span className="inline-flex items-center gap-1">
            <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
            {goal.currentLevel ?? '—'} → {goal.targetLevel ?? '—'}
          </span>
        )}
        {goal.type === 'exam' && goal.targetScore && (
          <span>
            {t('targetScore', { score: goal.targetScore })}
            {goal.actualScore && ` / ${t('actualScore', { score: goal.actualScore })}`}
          </span>
        )}
      </div>

      {progress != null && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
            <span>{t('taskProgress', { done: goal.doneTaskCount, total: goal.taskCount })}</span>
            <span>{progress}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-full"
              style={{ width: `${progress}%`, backgroundColor: goal.color }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
