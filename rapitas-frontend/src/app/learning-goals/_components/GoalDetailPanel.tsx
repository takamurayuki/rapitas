/**
 * GoalDetailPanel
 *
 * Displays the full detail view of a selected learning goal including
 * its generated plan phases, resources, tips, and progress tracking.
 */
'use client';

import { useTranslations } from 'next-intl';
import {
  Sparkles,
  Trash2,
  CheckCircle2,
  Lightbulb,
  ListTodo,
  BookOpen,
  Clock,
  Calendar,
  ArrowRight,
  Loader2,
  BookMarked,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Layers,
} from 'lucide-react';
import type { LearningGoal, GeneratedLearningPlan } from '@/types';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';

type Props = {
  goal: LearningGoal;
  plan: GeneratedLearningPlan | null;
  applying: boolean;
  adapting: boolean;
  progress?: { total: number; completed: number; rate: number };
  expandedPhases: Set<number>;
  onTogglePhase: (index: number) => void;
  onApply: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onAdapt: () => void;
};

/**
 * Full detail panel for a single learning goal.
 *
 * @param props - goal, plan, action handlers, and expansion state.
 */
export function GoalDetailPanel({
  goal,
  plan,
  applying,
  adapting,
  progress,
  expandedPhases,
  onTogglePhase,
  onApply,
  onRegenerate,
  onDelete,
  onAdapt,
}: Props) {
  const t = useTranslations('learning');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            {goal.title}
            {goal.isApplied && (
              <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium rounded-full">
                {t('applied')}
              </span>
            )}
          </h2>
          {goal.description && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
              {goal.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {plan && !goal.isApplied && (
            <button
              onClick={onApply}
              disabled={applying}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {applying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t('applying')}</span>
                </>
              ) : (
                <>
                  <ListTodo className="w-4 h-4" />
                  <span>{t('applyToTasks')}</span>
                </>
              )}
            </button>
          )}
          {!goal.isApplied && (
            <button
              onClick={onRegenerate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors text-zinc-700 dark:text-zinc-300"
            >
              <Sparkles className="w-4 h-4" />
              <span>{t('regenerate')}</span>
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
        {goal.currentLevel && (
          <div className="flex items-center gap-1.5">
            <ArrowRight className="w-4 h-4" />
            <span>
              {goal.currentLevel} → {goal.targetLevel || t('unspecified')}
            </span>
          </div>
        )}
        {goal.deadline && (
          <div className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4" />
            <span>〜{new Date(goal.deadline).toLocaleDateString(dateLocale)}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Clock className="w-4 h-4" />
          <span>
            {goal.dailyHours}
            {t('hoursPerDayUnit')}
          </span>
        </div>
      </div>

      {/* Progress section */}
      {goal.isApplied && progress && (
        <div className="mb-6 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t('phaseProgress')}
              </span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {progress.completed}/{progress.total} ({Math.round(progress.rate * 100)}%)
              </span>
            </div>
            <div className="w-full h-2.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.round(progress.rate * 100)}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={`/flashcards?learningGoalId=${goal.id}`}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
            >
              <Layers className="w-4 h-4" />
              {t('flashcardReview')}
            </a>
            {progress.rate >= 0.3 && (
              <button
                onClick={onAdapt}
                disabled={adapting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50"
              >
                {adapting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                {t('adaptPlan')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Plan phases */}
      {plan ? (
        <>
          <div className="space-y-3 mb-6">
            {plan.phases.map((phase, index) => (
              <div
                key={index}
                className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden"
              >
                <button
                  onClick={() => onTogglePhase(index)}
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold text-sm shrink-0">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">
                      {phase.name}
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {phase.days}
                      {t('daysCount')} ・ {phase.tasks.length}
                      {t('tasksCount')}
                      {phase.description && ` ・ ${phase.description}`}
                    </p>
                  </div>
                  {expandedPhases.has(index) ? (
                    <ChevronUp className="w-5 h-5 text-zinc-400 shrink-0" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-zinc-400 shrink-0" />
                  )}
                </button>
                {expandedPhases.has(index) && (
                  <div className="border-t border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
                    {phase.tasks.map((task, taskIndex) => (
                      <div
                        key={taskIndex}
                        className="bg-zinc-50 dark:bg-zinc-700/30 rounded-lg p-3"
                      >
                        <div className="flex items-start gap-2">
                          <BookOpen className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" />
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-sm text-zinc-800 dark:text-zinc-200">
                              {task.title}
                            </h4>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 whitespace-pre-wrap">
                              {task.description}
                            </p>
                            <div className="flex items-center gap-3 mt-2">
                              {task.estimatedHours && (
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {task.estimatedHours}h
                                </span>
                              )}
                              {task.priority && (
                                <span
                                  className={`text-xs px-1.5 py-0.5 rounded-full ${
                                    task.priority === 'high'
                                      ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                                      : task.priority === 'low'
                                        ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                                        : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                  }`}
                                >
                                  {task.priority === 'high'
                                    ? t('priorityHigh')
                                    : task.priority === 'low'
                                      ? t('priorityLow')
                                      : t('priorityMedium')}
                                </span>
                              )}
                            </div>
                            {task.subtasks && task.subtasks.length > 0 && (
                              <div className="mt-2 pl-3 border-l-2 border-emerald-200 dark:border-emerald-800 space-y-1.5">
                                {task.subtasks.map((sub, subIndex) => (
                                  <div key={subIndex} className="text-xs">
                                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                                      {sub.title}
                                    </span>
                                    {sub.description && (
                                      <span className="text-zinc-500 dark:text-zinc-400">
                                        {' '}- {sub.description}
                                      </span>
                                    )}
                                    {sub.estimatedHours && (
                                      <span className="text-zinc-400 dark:text-zinc-500">
                                        {' '}({sub.estimatedHours}h)
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Recommended resources */}
          {plan.recommendedResources && plan.recommendedResources.length > 0 && (
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 mb-4">
              <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-2 flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                {t('recommendedResources')}
              </h3>
              <div className="space-y-2">
                {plan.recommendedResources.map((resource, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-sm">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 mt-0.5 ${
                        resource.type === 'book'
                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                          : resource.type === 'course'
                            ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                            : resource.type === 'video'
                              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                              : resource.type === 'practice'
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      }`}
                    >
                      {resource.type === 'book'
                        ? t('resourceBook')
                        : resource.type === 'course'
                          ? t('resourceCourse')
                          : resource.type === 'video'
                            ? t('resourceVideo')
                            : resource.type === 'practice'
                              ? t('resourcePractice')
                              : t('resourceWeb')}
                    </span>
                    <div>
                      <span className="font-medium text-blue-800 dark:text-blue-200">
                        {resource.title}
                      </span>
                      <span className="text-blue-600 dark:text-blue-300">
                        {' '}- {resource.description}
                      </span>
                      {resource.url && (
                        <a
                          href={resource.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 ml-1 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tips */}
          {plan.tips && plan.tips.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 mb-4">
              <h3 className="font-semibold text-amber-800 dark:text-amber-200 mb-2 flex items-center gap-2">
                <Lightbulb className="w-4 h-4" />
                {t('learningTips')}
              </h3>
              <ul className="space-y-1">
                {plan.tips.map((tip, index) => (
                  <li key={index} className="text-sm text-amber-700 dark:text-amber-300">
                    • {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!goal.isApplied && (
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-4">
              <p className="text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <ListTodo className="w-4 h-4 shrink-0" />
                {t('applyTaskGuide')}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-8">
          <Sparkles className="w-10 h-10 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('noPlanYet')}</p>
          <button
            onClick={onRegenerate}
            className="mt-3 flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors mx-auto"
          >
            <Sparkles className="w-4 h-4" />
            {t('generatePlan')}
          </button>
        </div>
      )}
    </div>
  );
}

export { BookMarked };
