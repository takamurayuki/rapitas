'use client';
/**
 * ProbeMetricsPanel
 *
 * Read-only table of preflight probe metrics per target: success rate,
 * average latency and outcome breakdown from GET /agents/probe-metrics.
 * Same layout convention as RecoveryMetricsPanel. Not responsible for
 * changing any probe behavior — measurement display only.
 */
import { useEffect, useState } from 'react';
import { Radar } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import type { PanelMeta } from './panel-types';

/**
 * Registered with scripts/generate-agents-panels.mjs — see panel-types.ts.
 *
 * This panel landed on develop while this branch was introducing the generated
 * registry, so it arrived without a meta and the generator silently left it out
 * of AGENTS_PANELS — the panel would have disappeared from the page with no
 * type error and no failing test to say so.
 */
export const panelMeta: PanelMeta = { id: 'probe-metrics', order: 30 };

/** One aggregated per-target row from the metrics API. */
interface ProbeMetric {
  targetId: string;
  attempts: number;
  successes: number;
  transientRetries: number;
  permanentFailures: number;
  successRate: number;
  avgLatencyMs: number;
  lowSample: boolean;
}

/** Response shape of GET /agents/probe-metrics. */
interface ProbeMetricsResponse {
  metrics: ProbeMetric[];
  windowDays: number;
  minSamples: number;
  generatedAtMs: number;
}

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

function MetricRow({ metric, lowSampleLabel }: { metric: ProbeMetric; lowSampleLabel: string }) {
  return (
    <tr className="border-t border-zinc-100 dark:border-zinc-700">
      <td className="px-4 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {metric.targetId}
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
        {metric.transientRetries}
      </td>
      <td className="px-4 py-2 text-right text-zinc-900 dark:text-zinc-100">
        {metric.permanentFailures}
      </td>
    </tr>
  );
}

export function ProbeMetricsPanel() {
  const t = useTranslations('agents');
  const [data, setData] = useState<ProbeMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(`${API_BASE_URL}/agents/probe-metrics`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ProbeMetricsResponse;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Same convention as RecoveryMetricsPanel: render nothing until the first
  // response settles to avoid a flash of the empty/error state.
  if (loading) return null;

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <Radar className="h-4 w-4 text-zinc-400 dark:text-zinc-500" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {t('probeMetrics.title')}
        </h3>
        {data && (
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {t('probeMetrics.window', { days: data.windowDays })}
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
        {error || !data ? (
          <p className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
            {t('probeMetrics.loadFailed')}
          </p>
        ) : data.metrics.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
            {t('probeMetrics.empty')}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                <th className="px-4 py-2 font-medium">{t('probeMetrics.target')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('probeMetrics.attempts')}</th>
                <th className="px-4 py-2 text-right font-medium">
                  {t('probeMetrics.successRate')}
                </th>
                <th className="px-4 py-2 text-right font-medium">{t('probeMetrics.avgLatency')}</th>
                <th className="px-4 py-2 text-right font-medium">
                  {t('probeMetrics.transientRetries')}
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  {t('probeMetrics.permanentFailures')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.metrics.map((metric) => (
                <MetricRow
                  key={metric.targetId}
                  metric={metric}
                  lowSampleLabel={t('probeMetrics.lowSample')}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default ProbeMetricsPanel;
