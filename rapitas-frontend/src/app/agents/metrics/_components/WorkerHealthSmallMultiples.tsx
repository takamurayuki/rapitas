'use client';
/**
 * WorkerHealthSmallMultiples
 *
 * Four small per-metric panels (raw value, signed deviation z, sparkline) that
 * explain the composite score. This is where an alert's evidence is checked —
 * the composite line is only a first-pass screen. Contains no fetching.
 */
import { LineChart, Line, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useTranslations } from 'next-intl';
import {
  WORKER_HEALTH_METRIC_ORDER,
  type WorkerHealthMetricKey,
  type WorkerHealthPoint,
} from '../_hooks/useWorkerHealth';

interface WorkerHealthSmallMultiplesProps {
  points: WorkerHealthPoint[];
  weights: Record<WorkerHealthMetricKey, number>;
  selectedMetric: WorkerHealthMetricKey | null;
  onSelectMetric: (metric: WorkerHealthMetricKey) => void;
}

function formatRaw(metric: WorkerHealthMetricKey, v: number | null): string {
  if (v === null) return '—';
  return metric === 'timeoutRate' || metric === 'retryRate' ? `${(v * 100).toFixed(1)}%` : `${v}`;
}

/**
 * Render the four per-metric breakdown panels.
 *
 * @param props - Points, weights, current selection and selection callback.
 */
export function WorkerHealthSmallMultiples({
  points,
  weights,
  selectedMetric,
  onSelectMetric,
}: WorkerHealthSmallMultiplesProps) {
  const t = useTranslations('agents');
  const latest = points.length > 0 ? points[points.length - 1] : null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="worker-health-multiples">
      {WORKER_HEALTH_METRIC_ORDER.map((metric) => {
        const selected = selectedMetric === metric;
        const z = latest?.z[metric] ?? null;
        const series = points.map((p) => ({ t: p.t, z: p.z[metric] }));
        return (
          <button
            key={metric}
            type="button"
            data-testid={`worker-health-metric-${metric}`}
            aria-pressed={selected}
            onClick={() => onSelectMetric(metric)}
            className={`text-left rounded-lg border p-3 transition-colors bg-white dark:bg-zinc-800 ${
              selected
                ? 'border-indigo-500 ring-2 ring-indigo-500/40'
                : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500'
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                {t(`workerHealthMetric_${metric}`)}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {t('workerHealthWeightShort', { weight: weights[metric].toFixed(2) })}
              </span>
            </div>
            <div className="mt-1 flex items-baseline gap-3 text-xs text-zinc-600 dark:text-zinc-300">
              <span>
                {t('workerHealthRaw')}: <b>{formatRaw(metric, latest?.raw[metric] ?? null)}</b>
              </span>
              <span>
                z: <b>{z === null ? t('workerHealthPendingShort') : z.toFixed(1)}</b>
              </span>
            </div>
            <div className="h-12 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series}>
                  <ReferenceLine y={0} stroke="#a1a1aa" strokeDasharray="2 2" />
                  <Line
                    type="monotone"
                    dataKey="z"
                    stroke={selected ? '#6366f1' : '#71717a'}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </button>
        );
      })}
    </div>
  );
}
