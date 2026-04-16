'use client';
// GoalCard

import { Edit2, Trash2, CheckCircle2, Calendar, Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ExamGoal } from '@/types';
import { getIconComponent } from '@/components/category/icon-data';
import { ExamCountdown } from '@/components/exam-countdown/ExamCountdown';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';

interface UpcomingGoalCardProps {
  goal: ExamGoal;
  onComplete: (goal: ExamGoal) => void;
  onEdit: (goal: ExamGoal) => void;
  onDelete: (id: number) => void;
}

interface CompletedGoalCardProps {
  goal: ExamGoal;
  onDelete: (id: number) => void;
}

/**
 * Render an icon by name, falling back to the Target icon.
 *
 * @param iconName - Lucide icon identifier / Lucideアイコン識別子
 * @param size - Icon size in pixels / ピクセル単位のアイコンサイズ
 * @returns React element / Reactエレメント
 */
export function renderGoalIcon(iconName: string | null | undefined, size = 20) {
  const IconComponent = getIconComponent(iconName || '');
  if (!IconComponent) return <Target size={size} />;
  return <IconComponent size={size} />;
}

/**
 * Card for an upcoming (not yet completed) exam goal.
 *
 * @param props.goal - Goal data / 目標データ
 * @param props.onComplete - Mark-complete handler / 完了マークハンドラー
 * @param props.onEdit - Open-edit handler / 編集ハンドラー
 * @param props.onDelete - Delete handler / 削除ハンドラー
 */
export function UpcomingGoalCard({
  goal,
  onComplete,
  onEdit,
  onDelete,
}: UpcomingGoalCardProps) {
  const t = useTranslations('examGoals');

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${goal.color}20`, color: goal.color }}
          >
            {renderGoalIcon(goal.icon, 22)}
          </div>
          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
              {goal.name}
            </h3>
            {goal.targetScore && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {t('target')} {goal.targetScore}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onComplete(goal)}
            className="p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
            title={t('markComplete')}
          >
            <CheckCircle2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onEdit(goal)}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(goal.id)}
            className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {goal.description && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
          {goal.description}
        </p>
      )}

      <div className="mt-1">
        <ExamCountdown examDate={goal.examDate} color={goal.color} />
      </div>

      {goal._count && goal._count.tasks > 0 && (
        <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-700">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {t('relatedTasks', { count: goal._count.tasks })}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Card for a completed exam goal (muted appearance, delete-only actions).
 *
 * @param props.goal - Goal data / 目標データ
 * @param props.onDelete - Delete handler / 削除ハンドラー
 */
export function CompletedGoalCard({ goal, onDelete }: CompletedGoalCardProps) {
  const t = useTranslations('examGoals');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);

  return (
    <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 opacity-75">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${goal.color}20`, color: goal.color }}
          >
            {renderGoalIcon(goal.icon, 22)}
          </div>
          <div>
            <h3 className="font-semibold text-zinc-700 dark:text-zinc-300 line-through">
              {goal.name}
            </h3>
            {goal.actualScore && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">
                {t('result')} {goal.actualScore}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => onDelete(goal.id)}
          className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <Calendar className="w-4 h-4" />
        <span>{new Date(goal.examDate).toLocaleDateString(dateLocale)}</span>
      </div>
    </div>
  );
}
