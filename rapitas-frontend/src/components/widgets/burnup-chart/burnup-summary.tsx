/**
 * BurnupSummary
 *
 * Inline summary stats (completed / added / remaining / velocity) for the
 * burnup chart header. Pure presentational.
 */
'use client';
import { useTranslations } from 'next-intl';
import { Award, Calendar, Target, Zap } from 'lucide-react';
import type { BurnupData } from './use-burnup-data';

interface BurnupSummaryProps {
  summary: BurnupData['summary'];
  /** Show the small stat icons (desktop layout only). / 統計アイコンの表示（デスクトップのみ）。 */
  withIcons?: boolean;
  className?: string;
}

/**
 * Render the burnup summary stat row.
 *
 * @param props - Summary values plus layout flags. / サマリ値とレイアウトフラグ。
 */
export function BurnupSummary({ summary, withIcons = false, className = '' }: BurnupSummaryProps) {
  const t = useTranslations('burnupChart');

  // NOTE: Only "completed" keeps a hue (green = success, app-wide status
  // meaning); the other stats stay zinc so color keeps carrying meaning.
  return (
    <div className={`items-center gap-3 text-xs ${className}`}>
      <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
        {withIcons && <Award className="w-3 h-3" />}
        {t('completed')}
        <span className="font-semibold">{summary.totalCompleted}</span>
      </span>
      <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
        {withIcons && <Calendar className="w-3 h-3" />}
        {t('added')}
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">{summary.totalAdded}</span>
      </span>
      <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
        {withIcons && <Target className="w-3 h-3" />}
        {t('remaining')}
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
          {summary.currentRemaining}
        </span>
      </span>
      <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
        {withIcons && <Zap className="w-3 h-3" />}
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">{summary.velocity}</span>
        {t('perDay')}
      </span>
    </div>
  );
}
