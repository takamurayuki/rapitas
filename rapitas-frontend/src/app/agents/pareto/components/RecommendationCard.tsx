'use client';
/**
 * RecommendationCard
 *
 * Shows one segment's what-if verdict: the recommended parameter set (or the
 * closest alternative when the goal is unreachable), the current mix it is
 * compared against, the projected monthly cost/time/success deltas and the
 * sample-backed confidence. Pure presentational.
 */
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ParetoPoint, SegmentRecommendation } from '../types';
import { formatInterval, formatSigned, formatUsd, toSeconds } from '../pareto.utils';

interface RecommendationCardProps {
  recommendation: SegmentRecommendation;
}

function PointSummary({ label, point }: { label: string; point: ParetoPoint }) {
  const t = useTranslations('agents.pareto.table');
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="font-semibold text-zinc-900 dark:text-zinc-100">
        {point.parameterSet.model}
      </div>
      <dl className="mt-1 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">
        <div>
          {t('successRate')}: {formatInterval(point.successRate)}%
        </div>
        <div>
          {t('timeSec')}: {formatInterval(point.executionTimeMs, (v) => toSeconds(v).toFixed(1))}s
        </div>
        <div>
          {t('costUsd')}: {formatInterval(point.costUsd, formatUsd)}
        </div>
        <div>
          {t('samples')}: {point.sampleSize}
        </div>
      </dl>
    </div>
  );
}

/**
 * Renders one segment recommendation.
 *
 * @param props - Recommendation payload.
 */
export function RecommendationCard({ recommendation: r }: RecommendationCardProps) {
  const t = useTranslations('agents.pareto');
  const tw = useTranslations('agents.pareto.workflowType');
  const tr = useTranslations('agents.pareto.roles');
  const ReasonIcon = r.feasible
    ? CheckCircle2
    : r.reason === 'insufficient_data'
      ? Info
      : AlertTriangle;
  const reasonClass = r.feasible
    ? 'text-emerald-600 dark:text-emerald-400'
    : r.reason === 'insufficient_data'
      ? 'text-zinc-500 dark:text-zinc-400'
      : 'text-amber-600 dark:text-amber-400';
  const focus = r.recommended ?? r.bestAlternative;
  const focusLabel = r.recommended
    ? t('recommendation.recommended')
    : t('recommendation.alternative');

  return (
    <div
      className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
      data-testid="recommendation-card"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">
          {t('segment.title', {
            workflowType: tw(r.workflowType),
            role: tr.has(r.role) ? tr(r.role) : r.role,
          })}
        </h4>
        <span className={`flex items-center gap-1 text-xs ${reasonClass}`}>
          <ReasonIcon className="h-4 w-4" />
          {t(`recommendation.reason.${r.reason}`)}
        </span>
      </div>

      {focus ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {t('recommendation.current')}
            </div>
            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
              {t('segment.baseline')}
            </div>
            <dl className="mt-1 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">
              <div>
                {t('table.successRate')}: {formatInterval(r.baseline.successRate)}%
              </div>
              <div>
                {t('table.timeSec')}:{' '}
                {formatInterval(r.baseline.executionTimeMs, (v) => toSeconds(v).toFixed(1))}s
              </div>
              <div>
                {t('table.costUsd')}: {formatInterval(r.baseline.costUsd, formatUsd)}
              </div>
              <div>
                {t('table.samples')}: {r.baseline.sampleSize}
              </div>
            </dl>
          </div>
          <PointSummary label={focusLabel} point={focus} />
        </div>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t('recommendation.insufficientHint', { min: 5 })}
        </p>
      )}

      {r.projection && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
          <div>
            <div className="text-zinc-500 dark:text-zinc-400">
              {t('recommendation.monthlyVolume')}
            </div>
            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
              {r.projection.monthlyVolume}
            </div>
          </div>
          <div>
            <div className="text-zinc-500 dark:text-zinc-400">{t('recommendation.deltaCost')}</div>
            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
              {formatSigned(r.projection.deltaCostUsdPerMonth, 2, ' USD')}
            </div>
          </div>
          <div>
            <div className="text-zinc-500 dark:text-zinc-400">{t('recommendation.deltaTime')}</div>
            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
              {formatSigned(toSeconds(r.projection.deltaTimeMsPerExecution), 1, 's')}
            </div>
          </div>
          <div>
            <div className="text-zinc-500 dark:text-zinc-400">{t('recommendation.deltaHours')}</div>
            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
              {formatSigned(r.projection.deltaMonthlyHours, 2, 'h')}
            </div>
          </div>
          <div>
            <div className="text-zinc-500 dark:text-zinc-400">
              {t('recommendation.deltaSuccess')}
            </div>
            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
              {formatSigned(r.projection.deltaSuccessRatePoints, 1, 'pt')}
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-400">
        <span>
          {t('recommendation.confidence')}: {(r.confidence * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
