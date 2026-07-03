'use client';
/**
 * CiTimingDashboard
 *
 * Visualizes CI test timing analytics: slowest tests (BarChart), serial gate vs full suite
 * comparison, and promotion/demotion candidates. Sourced from `bun run test:timing` cache.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Timer, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';

/** Shared tooltip style matching MetricsCharts.tsx dark-mode palette. */
const tooltipStyle = {
  backgroundColor: 'rgb(39, 39, 42)',
  border: '1px solid rgb(63, 63, 70)',
  borderRadius: '8px',
  color: 'white',
};

interface TimingEntry {
  file: string;
  elapsedMs: number;
  exitCode: number;
  inGate: boolean;
  failed: boolean;
}

interface TimingStats {
  mean: number;
  p50: number;
  p90: number;
  max: number;
  count: number;
}

interface CiTimingData {
  available: boolean;
  note?: string;
  generatedAt?: string;
  wallClockMs?: number;
  totalFiles: number;
  stats: TimingStats;
  serialGate: TimingEntry[];
  slowest: TimingEntry[];
  promotionCandidates: TimingEntry[];
  demotionCandidates: TimingEntry[];
  promoteThresholdMs: number;
  missingFromResults: string[];
}

/** Format ms value for display (≥1000ms shows as Xs). */
function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/** Truncate file path to basename without .test.ts suffix for chart labels. */
function shortLabel(file: string): string {
  const base = file.split('/').pop() ?? file;
  return base.replace(/\.test\.ts$/, '');
}

/**
 * Card component for the CI test timing dashboard.
 * Shows slowest-test chart, gate comparison, and promotion/demotion tables.
 */
export function CiTimingDashboard() {
  const t = useTranslations('settings.ciTimingDashboard');
  const locale = useLocaleStore((s) => s.locale);
  const [data, setData] = useState<CiTimingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/ci-timing`);
      const json = (await res.json()) as { success: boolean; data: CiTimingData; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('fetchFailed'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is stable across renders; omitted to avoid re-triggering the fetch effect.
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const chartData = (data?.slowest ?? []).map((e) => ({
    label: shortLabel(e.file),
    file: e.file,
    elapsedMs: Math.round(e.elapsedMs),
    failed: e.failed,
    inGate: e.inGate,
  }));

  const serialGateTotalMs = (data?.serialGate ?? []).reduce((s, e) => s + e.elapsedMs, 0);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-indigo-dark-900">
      {/* Header */}
      <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Timer className="h-5 w-5 text-violet-500" />
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">{t('title')}</h2>
          </div>
          <button
            onClick={() => void fetchData()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t('refresh')}
          </button>
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">
            bun run test:timing
          </code>{' '}
          {t('cacheVisualization')}
        </p>
      </div>

      <div className="space-y-6 p-6">
        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !data && (
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('fetchingData')}
          </div>
        )}

        {/* No cache available */}
        {!loading && data && !data.available && (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
            <p className="font-medium">{t('noCache')}</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {t('generateCacheHint')}
            </p>
            <code className="mt-2 block rounded bg-zinc-100 px-3 py-1.5 text-xs dark:bg-zinc-900">
              bun run test:timing
            </code>
            {data.note && (
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">{data.note}</p>
            )}
          </div>
        )}

        {/* Analytics content */}
        {!loading && data?.available && (
          <>
            {/* Summary stats */}
            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {t('summary')}
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: t('measuredFiles'), value: t('itemsCount', { count: data.totalFiles }) },
                  { label: t('mean'), value: fmtMs(data.stats.mean) },
                  { label: 'P90', value: fmtMs(data.stats.p90) },
                  { label: t('max'), value: fmtMs(data.stats.max) },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50"
                  >
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
                    <p className="mt-0.5 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
              {data.generatedAt && (
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                  {t('cacheGeneratedAt', {
                    datetime: new Date(data.generatedAt).toLocaleString(toDateLocale(locale)),
                  })}{' '}
                  {data.wallClockMs !== undefined &&
                    t('wallClockSuffix', { wallClock: fmtMs(data.wallClockMs) })}
                </p>
              )}
            </div>

            {/* Slowest N files chart */}
            {chartData.length > 0 && (
              <div>
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {t('slowestTests', { count: chartData.length })} —{' '}
                  <span className="text-indigo-500">●</span> {t('legendNormal')}{' '}
                  <span className="text-green-500">●</span> {t('legendInGate')}{' '}
                  <span className="text-red-500">●</span> {t('legendFailed')}
                </p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={chartData} margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                      <XAxis
                        type="number"
                        stroke="#6b7280"
                        fontSize={11}
                        tickFormatter={(v: number) => `${v}ms`}
                      />
                      <YAxis
                        type="category"
                        dataKey="label"
                        stroke="#6b7280"
                        fontSize={10}
                        width={130}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(v, _name, props) => [
                          `${Number(v)}ms`,
                          (props.payload as { file?: string } | undefined)?.file ?? '',
                        ]}
                      />
                      <Bar dataKey="elapsedMs" maxBarSize={20}>
                        {chartData.map((entry, index) => (
                          <Cell
                            key={index}
                            fill={entry.failed ? '#ef4444' : entry.inGate ? '#10b981' : '#3b82f6'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Gate comparison */}
            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {t('gateComparisonTitle')}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
                  <p className="text-xs text-green-600 dark:text-green-400">
                    {t('serialGateTotal', { fileCount: data.serialGate.length })}
                  </p>
                  <p className="mt-0.5 text-lg font-semibold text-green-700 dark:text-green-300">
                    {fmtMs(serialGateTotalMs)}
                  </p>
                  <p className="text-xs text-green-500 dark:text-green-500">
                    {t('serialExecution')}
                  </p>
                </div>
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-800 dark:bg-indigo-900/20">
                  <p className="text-xs text-indigo-600 dark:text-indigo-400">
                    {t('overallWallClock', { fileCount: data.totalFiles })}
                  </p>
                  <p className="mt-0.5 text-lg font-semibold text-indigo-700 dark:text-indigo-300">
                    {data.wallClockMs !== undefined ? fmtMs(data.wallClockMs) : '—'}
                  </p>
                  <p className="text-xs text-indigo-500 dark:text-indigo-500">
                    {t('parallelExecution')}
                  </p>
                </div>
              </div>
              {data.missingFromResults.length > 0 && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  ⚠ {t('missingFromResults')} {data.missingFromResults.join(', ')}
                </p>
              )}
            </div>

            {/* Promotion candidates */}
            {data.promotionCandidates.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {t('promotionCandidatesTitle', { threshold: fmtMs(data.promoteThresholdMs) })}
                  <span className="ml-2 font-normal normal-case text-zinc-500">
                    {t('promotionCandidatesHint', { count: data.promotionCandidates.length })}
                  </span>
                </p>
                <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50">
                        <th className="px-3 py-2 text-left text-zinc-500 dark:text-zinc-400">
                          {t('fileColumn')}
                        </th>
                        <th className="px-3 py-2 text-right text-zinc-500 dark:text-zinc-400">
                          {t('timeColumn')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.promotionCandidates.slice(0, 20).map((e) => (
                        <tr
                          key={e.file}
                          className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                        >
                          <td className="px-3 py-1.5 font-mono text-zinc-700 dark:text-zinc-300">
                            {e.file}
                          </td>
                          <td className="px-3 py-1.5 text-right text-zinc-600 dark:text-zinc-400">
                            {fmtMs(e.elapsedMs)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Demotion candidates */}
            {data.demotionCandidates.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {t('demotionCandidatesTitle', { threshold: fmtMs(data.promoteThresholdMs) })}
                  <span className="ml-2 font-normal normal-case text-zinc-500">
                    {t('demotionCandidatesHint', { count: data.demotionCandidates.length })}
                  </span>
                </p>
                <div className="overflow-hidden rounded-lg border border-amber-200 dark:border-amber-800">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20">
                        <th className="px-3 py-2 text-left text-amber-600 dark:text-amber-400">
                          {t('fileColumn')}
                        </th>
                        <th className="px-3 py-2 text-right text-amber-600 dark:text-amber-400">
                          {t('timeColumn')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.demotionCandidates.map((e) => (
                        <tr
                          key={e.file}
                          className="border-b border-amber-100 last:border-0 dark:border-amber-900/20"
                        >
                          <td className="px-3 py-1.5 font-mono text-zinc-700 dark:text-zinc-300">
                            {e.file}
                          </td>
                          <td className="px-3 py-1.5 text-right text-amber-600 dark:text-amber-400">
                            {fmtMs(e.elapsedMs)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* All candidates absent */}
            {data.promotionCandidates.length === 0 && data.demotionCandidates.length === 0 && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {t('noCandidates', { threshold: fmtMs(data.promoteThresholdMs) })}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
