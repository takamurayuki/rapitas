'use client';
// MetricsOverviewCards
import { Activity, Zap, Users, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { MetricsOverview, TokenBreakdown } from '../_hooks/useMetricsData';

interface MetricsOverviewCardsProps {
  overview: MetricsOverview;
}

/**
 * Below this many completed tasks the first-pass rate is shown without the
 * confident styling. A trailing week often completes two or three tasks, and
 * "100.0%" off two is the same false verdict this card replaced; this repo's
 * own determinism audit found conclusions flipping below twelve samples.
 */
const MIN_FIRST_PASS_SAMPLE = 12;

/**
 * Share of the token volume taken by cache reads and by output, as fixed-1
 * strings for the mix line. Cache read is the class that usually dominates and
 * is the cheapest; output is the one that tracks real work.
 *
 * @param breakdown - Per-class token counts, absent on an older backend / 種別別トークン
 * @returns Percent strings, or null when nothing was recorded / 割合（記録なしならnull）
 */
function resolveTokenMix(
  breakdown: TokenBreakdown | undefined,
): { cache: string; output: string } | null {
  if (!breakdown) return null;
  const total = breakdown.input + breakdown.output + breakdown.cacheRead + breakdown.cacheCreation;
  // Guard the division, not just the absent object: a window with no executions
  // has a breakdown of four zeros and would render NaN%.
  if (total <= 0) return null;
  return {
    cache: ((breakdown.cacheRead / total) * 100).toFixed(1),
    output: ((breakdown.output / total) * 100).toFixed(1),
  };
}

/**
 * Renders the four metrics overview stats as a compact neutral KPI bar.
 *
 * NOTE: Replaced the full-height multi-hue gradient cards with the dashboard's
 * KPI-bar pattern (borders, single-hue icons) — the gradient stat-card grid is
 * a banned template per ui-design-language.md §2 tells #3/#6.
 *
 * @param overview - Aggregated metrics overview data / 集計メトリクス概要データ
 */
export function MetricsOverviewCards({ overview }: MetricsOverviewCardsProps) {
  const t = useTranslations('agents');
  const firstPass = overview.firstPassCompletion;
  const thinSample = (firstPass?.completedTasks ?? 0) < MIN_FIRST_PASS_SAMPLE;
  const tokenMix = resolveTokenMix(overview.tokenBreakdown);

  return (
    <div className="mb-8 grid grid-cols-2 divide-x divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white md:grid-cols-4 md:divide-y-0 dark:divide-zinc-700 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="flex items-center gap-3 px-4 py-3">
        <Activity className="h-5 w-5 shrink-0 text-indigo-500" />
        <div className="min-w-0">
          <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
            {/* NOTE: numeric thousands-separator display, not a date — out of scope for #847 */}
            {overview.totalExecutions.toLocaleString()}
          </div>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {t('totalExecutions')}
          </p>
        </div>
      </div>

      {/* NOTE: The big number is the TASK-level first-pass rate since #1300.
          It used to be `overallSuccessRate` under the label 成功率, which is
          the share of CLI processes that exited 0 — 95.57% while 36-53% of the
          tasks completed in the same weeks had needed a verify_repair. That
          rate is a liveness signal, so it keeps the line below but not the
          figure the eye lands on. */}
      <div className="flex items-center gap-3 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
        <div className="min-w-0">
          <div
            className={`text-xl font-bold leading-tight ${
              thinSample ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-900 dark:text-zinc-50'
            }`}
          >
            {/* An em dash, not 0% — an empty denominator is "no data", while 0
                would read as "every task needed a repair". */}
            {firstPass?.rate == null ? '—' : `${(firstPass.rate * 100).toFixed(1)}%`}
          </div>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {t('firstPassCompletion')} ·{' '}
            {firstPass?.rate == null
              ? t('firstPassCompletionEmpty')
              : t('firstPassCompletionSample', { count: firstPass.completedTasks })}
            {thinSample && firstPass?.rate != null ? ` · ${t('firstPassCompletionLowSample')}` : ''}
          </p>
          <p className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
            {t('executionCompletionRate', { rate: overview.overallSuccessRate.toFixed(1) })}
          </p>
        </div>
      </div>

      {/* NOTE: The mix line exists because the total on its own said nothing
          (#1302): it sums four classes whose prices differ by about 10x, and
          94.78% of the volume here is cache reads. Knowing the composition is
          what makes the figure actionable — a total that grew because cache
          reads grew costs a tenth of one that grew on fresh input. */}
      <div className="flex items-center gap-3 px-4 py-3">
        <Zap className="h-5 w-5 shrink-0 text-purple-500" />
        <div className="min-w-0">
          <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
            {(overview.totalTokensUsed / 1_000_000).toFixed(1)}M
          </div>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {t('totalTokenUsage')}
          </p>
          {tokenMix && (
            <p className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
              {t('tokenMix', tokenMix)}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <Users className="h-5 w-5 shrink-0 text-orange-500" />
        <div className="min-w-0">
          <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
            {overview.activeAgents} / {overview.totalAgents}
          </div>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{t('activeAgents')}</p>
        </div>
      </div>
    </div>
  );
}
