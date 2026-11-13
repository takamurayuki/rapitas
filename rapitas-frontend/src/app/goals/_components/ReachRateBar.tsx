'use client';
/**
 * ReachRateBar
 *
 * A goal's milestone reach rate (節目到達率): confirmed milestones over the
 * ones still being pursued. Paused milestones are shown but not counted.
 */
import { useTranslations } from 'next-intl';
import type { GoalProgress } from '../_hooks/goals.types';

/**
 * Renders the reach-rate bar and counts.
 *
 * @param progress - The goal's milestone totals / ゴールの節目集計
 */
export function ReachRateBar({ progress }: { progress: GoalProgress }) {
  const t = useTranslations('goals');
  const percent = progress.reachRate === null ? null : Math.round(progress.reachRate * 100);
  const pursued = progress.total - progress.paused;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span>{t('reachRate')}</span>
        <span className="tabular-nums">
          {percent === null
            ? t('noMilestonesYet')
            : t('reachRateValue', { percent, reached: progress.reached, pursued })}
          {progress.paused > 0 && ` · ${t('pausedCount', { count: progress.paused })}`}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        role="progressbar"
        aria-label={t('reachRate')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? 0}
      >
        <div
          className="h-full rounded-full bg-indigo-500 transition-[width]"
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
    </div>
  );
}
