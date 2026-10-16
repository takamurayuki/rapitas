'use client';
/**
 * RecoveryMetricsPanel
 *
 * Read-only table of fallback recovery metrics per (errorType × strategy):
 * success rate, average latency/cost and failure-reason distribution from
 * GET /agents/recovery-metrics. Surfaces the "no-candidate miss" rate the
 * token-efficiency audit flagged. Not responsible for changing any recovery
 * behavior — measurement display only.
 */
import { LifeBuoy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRecoveryMetrics, type RecoveryMetric } from './use-recovery-metrics';
import type { PanelMeta } from './panel-types';

/** Registered with scripts/generate-agents-panels.mjs — see panel-types.ts. */
export const panelMeta: PanelMeta = { id: 'recovery-metrics', order: 10 };

/** Render 0.25 → "25%" (one decimal only when informative). */
function formatRate(rate: number): string {
  const pct = rate * 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

/** Render latency ms compactly ("850ms" / "12.3s"). */
function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Top failure reasons as "reason×count" joined text (empty → "—"). */
function formatFailureReasons(reasons: Record<string, number>): string {
  const entries = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '—';
  return entries.map(([reason, count]) => `${reason}×${count}`).join(', ');
}

function MetricRow({ metric, lowSampleLabel }: { metric: RecoveryMetric; lowSampleLabel: string }) {
  return (
    <tr className="border-t border-zinc-100 dark:border-zinc-700">
      <td className="px-4 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {metric.errorType}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {metric.strategy}
      </td>
      <td className="px-4 py-2 text-right text-zinc-900 dark:text-zinc-100">
        {metric.attempts}
        {metric.lowSample && (
          <span className="ml-2 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
            {lowSampleLabel}
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-right text-zinc-900 dark:text-zinc-100">
        {formatRate(metric.successRate)}
      </td>
      <td className="px-4 py-2 text-right text-zinc-900 dark:text-zinc-100">
        {formatLatency(metric.avgLatencyMs)}
      </td>
      <td className="px-4 py-2 text-right text-zinc-900 dark:text-zinc-100">
        {metric.avgCostUsd === null ? '—' : `$${metric.avgCostUsd.toFixed(4)}`}
      </td>
      <td className="px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">
        {formatFailureReasons(metric.failureReasons)}
      </td>
    </tr>
  );
}

export function RecoveryMetricsPanel() {
  const t = useTranslations('agents');
  const { data, loading, error } = useRecoveryMetrics();

  // Same convention as SystemStatusPanel: render nothing until the first
  // response settles to avoid a flash of the empty/error state.
  if (loading) return null;

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <LifeBuoy className="h-4 w-4 text-zinc-400 dark:text-zinc-500" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {t('recoveryMetrics.title')}
        </h3>
        {data && (
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {t('recoveryMetrics.window', { days: data.windowDays })}
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
        {error || !data ? (
          <p className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
            {t('recoveryMetrics.loadFailed')}
          </p>
        ) : data.metrics.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
            {t('recoveryMetrics.empty')}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                <th className="px-4 py-2 font-medium">{t('recoveryMetrics.errorType')}</th>
                <th className="px-4 py-2 font-medium">{t('recoveryMetrics.strategy')}</th>
                <th className="px-4 py-2 text-right font-medium">
                  {t('recoveryMetrics.attempts')}
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  {t('recoveryMetrics.successRate')}
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  {t('recoveryMetrics.avgLatency')}
                </th>
                <th className="px-4 py-2 text-right font-medium">{t('recoveryMetrics.avgCost')}</th>
                <th className="px-4 py-2 font-medium">{t('recoveryMetrics.failureReasons')}</th>
              </tr>
            </thead>
            <tbody>
              {data.metrics.map((metric) => (
                <MetricRow
                  key={`${metric.errorType}-${metric.strategy}`}
                  metric={metric}
                  lowSampleLabel={t('recoveryMetrics.lowSample')}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default RecoveryMetricsPanel;
