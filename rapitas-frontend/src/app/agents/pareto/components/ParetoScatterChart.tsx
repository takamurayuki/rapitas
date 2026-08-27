'use client';
/**
 * ParetoScatterChart
 *
 * Scatter plot of one segment's candidate parameter sets: x = mean execution
 * time (s), y = success rate (%), bubble size = mean cost, with 95%
 * confidence intervals drawn as error bars on both axes. Pareto-optimal
 * points are joined by a line; dominated and data-starved points are drawn
 * in muted styles so the frontier reads at a glance.
 */
import { useTranslations } from 'next-intl';
import {
  CartesianGrid,
  ErrorBar,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type { ParetoPoint, SegmentBaseline } from '../types';
import { errorBarRange, formatInterval, formatUsd, toSeconds } from '../pareto.utils';

interface ParetoScatterChartProps {
  points: ParetoPoint[];
  baseline: SegmentBaseline;
}

/** One chart datum (recharts reads x/y/z plus the error-bar tuples). */
export interface ParetoDatum {
  name: string;
  x: number;
  y: number;
  z: number;
  errX: [number, number];
  errY: [number, number];
  point: ParetoPoint | null;
}

/**
 * Converts a point into chart coordinates (seconds / percent / USD).
 *
 * @param point - Frontier point.
 * @returns Chart datum with error-bar half-widths.
 */
export function toDatum(point: ParetoPoint): ParetoDatum {
  return {
    name: point.parameterSet.model,
    x: toSeconds(point.executionTimeMs.value),
    y: point.successRate.value,
    z: point.costUsd.value,
    errX: errorBarRange(point.executionTimeMs, toSeconds),
    errY: errorBarRange(point.successRate),
    point,
  };
}

interface TooltipPayload {
  payload?: ParetoDatum;
}

function ParetoTooltip({
  active,
  payload,
  labels,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  labels: { time: string; success: string; cost: string; samples: string; ci: string };
}) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) return null;
  const p = datum.point;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
      <div className="mb-1 font-semibold text-zinc-900 dark:text-zinc-100">{datum.name}</div>
      {p ? (
        <dl className="space-y-0.5 text-zinc-600 dark:text-zinc-300">
          <div>
            {labels.success}: {formatInterval(p.successRate)}%
          </div>
          <div>
            {labels.time}: {formatInterval(p.executionTimeMs, (v) => toSeconds(v).toFixed(1))}s
          </div>
          <div>
            {labels.cost}: {formatInterval(p.costUsd, formatUsd)}
          </div>
          <div>
            {labels.samples}: {p.sampleSize}
          </div>
          <div className="text-zinc-400">{labels.ci}</div>
        </dl>
      ) : (
        <div className="text-zinc-600 dark:text-zinc-300">
          {labels.success}: {datum.y.toFixed(1)}% / {labels.time}: {datum.x.toFixed(1)}s
        </div>
      )}
    </div>
  );
}

/**
 * Renders the segment scatter chart.
 *
 * @param props - Points and the segment baseline.
 */
export function ParetoScatterChart({ points, baseline }: ParetoScatterChartProps) {
  const t = useTranslations('agents.pareto');
  const optimal = points
    .filter((p) => p.paretoOptimal)
    .map(toDatum)
    .sort((a, b) => a.x - b.x);
  const dominated = points.filter((p) => p.reliable && !p.paretoOptimal).map(toDatum);
  const unreliable = points.filter((p) => !p.reliable).map(toDatum);
  const baselineDatum: ParetoDatum = {
    name: t('segment.baseline'),
    x: toSeconds(baseline.executionTimeMs.value),
    y: baseline.successRate.value,
    z: baseline.costUsd.value,
    errX: errorBarRange(baseline.executionTimeMs, toSeconds),
    errY: errorBarRange(baseline.successRate),
    point: null,
  };
  const labels = {
    time: t('table.timeSec'),
    success: t('table.successRate'),
    cost: t('table.costUsd'),
    samples: t('table.samples'),
    ci: t('table.ci'),
  };

  return (
    <div className="h-72 w-full" data-testid="pareto-scatter">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
          <XAxis
            type="number"
            dataKey="x"
            name={labels.time}
            unit="s"
            tick={{ fontSize: 11 }}
            label={{
              value: t('segment.axisTime'),
              position: 'insideBottom',
              offset: -5,
              fontSize: 11,
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={labels.success}
            unit="%"
            domain={[0, 100]}
            tick={{ fontSize: 11 }}
          />
          <ZAxis type="number" dataKey="z" range={[60, 400]} name={labels.cost} />
          <Tooltip content={<ParetoTooltip labels={labels} />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Scatter name={t('segment.frontier')} data={optimal} fill="#6366f1" line>
            <ErrorBar dataKey="errX" direction="x" width={4} stroke="#6366f1" strokeOpacity={0.5} />
            <ErrorBar dataKey="errY" direction="y" width={4} stroke="#6366f1" strokeOpacity={0.5} />
          </Scatter>
          <Scatter name={t('segment.dominated')} data={dominated} fill="#a1a1aa">
            <ErrorBar dataKey="errX" direction="x" width={4} stroke="#a1a1aa" strokeOpacity={0.5} />
            <ErrorBar dataKey="errY" direction="y" width={4} stroke="#a1a1aa" strokeOpacity={0.5} />
          </Scatter>
          <Scatter
            name={t('segment.unreliableShort')}
            data={unreliable}
            fill="#f59e0b"
            fillOpacity={0.4}
            shape="triangle"
          />
          <Scatter name={t('segment.baseline')} data={[baselineDatum]} fill="#10b981" shape="star">
            <ErrorBar dataKey="errY" direction="y" width={4} stroke="#10b981" strokeOpacity={0.6} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
