'use client';
/**
 * ParetoPointsTable
 *
 * Tabular view of a segment's candidate parameter sets with every objective
 * shown as `value [ciLow – ciHigh]`, so the confidence intervals the chart
 * draws are also readable as numbers. Pure presentational.
 */
import { useTranslations } from 'next-intl';
import type { ParetoPoint, SegmentBaseline } from '../types';
import { formatInterval, formatUsd, toSeconds } from '../pareto.utils';

interface ParetoPointsTableProps {
  points: ParetoPoint[];
  baseline: SegmentBaseline;
  minReliableSamples: number;
}

const TH = 'px-3 py-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400';
const TD = 'px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200 whitespace-nowrap';

/**
 * Renders the per-point table (baseline row first).
 *
 * @param props - Points, baseline and the reliability threshold.
 */
export function ParetoPointsTable({
  points,
  baseline,
  minReliableSamples,
}: ParetoPointsTableProps) {
  const t = useTranslations('agents.pareto');

  const statusOf = (p: ParetoPoint): { label: string; className: string } => {
    if (!p.reliable) {
      return {
        label: t('table.unreliable', { min: minReliableSamples }),
        className: 'text-amber-600 dark:text-amber-400',
      };
    }
    if (p.paretoOptimal) {
      return { label: t('table.optimal'), className: 'text-indigo-600 dark:text-indigo-400' };
    }
    return { label: t('table.dominated'), className: 'text-zinc-400' };
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
        <thead>
          <tr>
            <th className={TH}>{t('table.model')}</th>
            <th className={TH}>{t('table.samples')}</th>
            <th className={TH}>{t('table.successRate')}</th>
            <th className={TH}>{t('table.timeSec')}</th>
            <th className={TH}>{t('table.costUsd')}</th>
            <th className={TH}>{t('table.status')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
          <tr className="bg-emerald-50/60 dark:bg-emerald-900/10">
            <td className={`${TD} font-semibold`}>{t('segment.baseline')}</td>
            <td className={TD}>{baseline.sampleSize}</td>
            <td className={TD}>{formatInterval(baseline.successRate)}%</td>
            <td className={TD}>
              {formatInterval(baseline.executionTimeMs, (v) => toSeconds(v).toFixed(1))}s
            </td>
            <td className={TD}>{formatInterval(baseline.costUsd, formatUsd)}</td>
            <td className={`${TD} text-emerald-600 dark:text-emerald-400`}>
              {t('table.currentMix')}
            </td>
          </tr>
          {points.map((p) => {
            const status = statusOf(p);
            return (
              <tr key={p.key} data-testid="pareto-point-row">
                <td className={`${TD} font-medium`}>{p.parameterSet.model}</td>
                <td className={TD}>{p.sampleSize}</td>
                <td className={TD}>{formatInterval(p.successRate)}%</td>
                <td className={TD}>
                  {formatInterval(p.executionTimeMs, (v) => toSeconds(v).toFixed(1))}s
                </td>
                <td className={TD}>{formatInterval(p.costUsd, formatUsd)}</td>
                <td className={`${TD} ${status.className}`}>{status.label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-zinc-400">{t('table.ci')}</p>
    </div>
  );
}
