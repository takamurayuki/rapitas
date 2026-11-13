'use client';
/**
 * GoalCard
 *
 * One goal in the list: its name and statement, reach rate, the next open
 * milestone, and a link to the goal's milestones.
 */
import Link from 'next/link';
import { Milestone as MilestoneIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { GoalSummary } from '../_hooks/goals.types';
import { ReachRateBar } from './ReachRateBar';

/**
 * Renders a goal list card.
 *
 * @param goal - The goal summary / ゴールの要約
 */
export function GoalCard({ goal }: { goal: GoalSummary }) {
  const t = useTranslations('goals');
  return (
    <Link
      href={`/goals/detail?id=${goal.id}`}
      className="block rounded-xl border border-zinc-200 bg-white p-5 transition-colors hover:border-indigo-300 dark:border-zinc-800 dark:bg-indigo-dark-900 dark:hover:border-indigo-700"
    >
      <div className="mb-3 flex items-start gap-3">
        <span
          className="mt-1 h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: goal.color }}
          aria-hidden
        />
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-zinc-900 dark:text-zinc-50">{goal.name}</h2>
          {goal.description && (
            <p className="mt-0.5 line-clamp-2 text-sm text-zinc-500 dark:text-zinc-400">
              {goal.description}
            </p>
          )}
        </div>
      </div>
      <ReachRateBar progress={goal.progress} />
      <div className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        <MilestoneIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          {goal.nextMilestone
            ? t('nextMilestone', { name: goal.nextMilestone.name })
            : t('noOpenMilestone')}
        </span>
      </div>
    </Link>
  );
}
