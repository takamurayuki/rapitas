'use client';
/**
 * WorkerHealthCard
 *
 * Worker-health first-pass screen: composite deviation score as one line with
 * explicit metric weights, plus the per-metric breakdown. Not the source of
 * truth for an alert — the breakdown below it is. Contains no fetching.
 */
import { Waves, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import {
  WORKER_HEALTH_METRIC_ORDER,
  type WorkerHealthData,
  type WorkerHealthMetricKey,
  type WorkerHealthStatus,
} from '../_hooks/useWorkerHealth';
import { WorkerHealthSmallMultiples } from './WorkerHealthSmallMultiples';

interface WorkerHealthCardProps {
  data: WorkerHealthData | null;
  status: WorkerHealthStatus;
  selectedMetric: WorkerHealthMetricKey | null;
  onSelectMetric: (metric: WorkerHealthMetricKey) => void;
}

/** Compact "MM/DD HH" label for an ISO bucket start (local time). */
function labelOf(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}`;
}

/**
 * Render the worker-health card in loading, error, empty and data states.
 *
 * @param props - Series data, load status and per-metric selection wiring.
 */
export function WorkerHealthCard({
  data,
  status,
  selectedMetric,
  onSelectMetric,
}: WorkerHealthCardProps) {
  const t = useTranslations('agents');

  return (
    <section
      id="worker-health"
      className="my-6 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5"
    >
      <header className="flex items-center gap-3 mb-1">
        <Waves className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {t('workerHealthTitle')}
        </h2>
      </header>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
        {t('workerHealthDescription')}
      </p>

      {status === 'loading' && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('workerHealthLoading')}</p>
      )}
      {status === 'error' && (
        <p className="text-sm text-red-600 dark:text-red-400">{t('workerHealthError')}</p>
      )}
      {status === 'empty' && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('workerHealthEmpty')}</p>
      )}

      {status === 'success' && data && (
        <WorkerHealthBody
          data={data}
          selectedMetric={selectedMetric}
          onSelectMetric={onSelectMetric}
        />
      )}
    </section>
  );
}

function WorkerHealthBody({
  data,
  selectedMetric,
  onSelectMetric,
}: {
  data: WorkerHealthData;
  selectedMetric: WorkerHealthMetricKey | null;
  onSelectMetric: (metric: WorkerHealthMetricKey) => void;
}) {
  const t = useTranslations('agents');
  const chart = data.points.map((p) => ({ label: labelOf(p.t), composite: p.composite }));
  const allPending = data.points.every((p) => p.composite === null);
  const deviating = data.detection.run.fired || data.detection.periodicity.fired;

  return (
    <div className="space-y-4">
      {deviating && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {t('workerHealthDeviation')}
        </div>
      )}

      <ul
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300"
        data-testid="worker-health-weights"
        aria-label={t('workerHealthWeights')}
      >
        {WORKER_HEALTH_METRIC_ORDER.map((m) => (
          <li key={m}>
            {t(`workerHealthMetric_${m}`)} × <b>{data.weights[m].toFixed(2)}</b>
          </li>
        ))}
      </ul>

      {allPending ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400" data-testid="worker-health-pending">
          {t('workerHealthPending')}
        </p>
      ) : (
        <div className="h-56" data-testid="worker-health-composite">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#a1a1aa55" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={32} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <ReferenceLine
                y={data.rules.runThreshold}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                label={{ value: String(data.rules.runThreshold), fontSize: 11 }}
              />
              <Line
                type="monotone"
                dataKey="composite"
                name={t('workerHealthComposite')}
                stroke="#6366f1"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('workerHealthBaselineNote')}</p>

      <WorkerHealthSmallMultiples
        points={data.points}
        weights={data.weights}
        selectedMetric={selectedMetric}
        onSelectMetric={onSelectMetric}
      />
    </div>
  );
}
