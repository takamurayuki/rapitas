'use client';

/**
 * Analytics charts for the vocabulary book: the personal retention curve vs
 * the Ebbinghaus reference, and recall rate by time of day. Presentation only —
 * aggregates come from GET /vocab/analytics.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslations } from 'next-intl';
import type { HourPoint, RetentionPoint } from './vocab.types';

// Series color validated (dataviz six checks) against both the light and the
// dark (#111827) chart surfaces; the Ebbinghaus curve is a REFERENCE line —
// neutral gray + dashed + legend label, not a competing categorical hue.
const SERIES_COLOR = '#6366f1';
const REFERENCE_COLOR = '#a1a1aa';

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-zinc-800, #27272a)',
  border: '1px solid var(--color-zinc-700, #3f3f46)',
  borderRadius: '8px',
  color: '#f4f4f5',
  fontSize: '13px',
};

interface RetentionCurveChartProps {
  curve: RetentionPoint[];
}

/**
 * Personal forgetting curve against the classic Ebbinghaus reference.
 *
 * @param props - Curve points from the analytics API. / 忘却曲線の点列。
 */
export function RetentionCurveChart({ curve }: RetentionCurveChartProps) {
  const t = useTranslations('vocabulary.analytics');
  const data = curve.map((p) => ({
    label: t(`buckets.${p.key}`),
    personal: p.rate,
    reference: p.reference,
    samples: p.samples,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} className="fill-zinc-500" />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 11 }}
          className="fill-zinc-500"
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={
            ((value: unknown, name: unknown) => [
              value == null ? t('noData') : `${value}%`,
              name === 'personal' ? t('seriesPersonal') : t('seriesEbbinghaus'),
            ]) as never
          }
        />
        <Legend
          formatter={(value) =>
            value === 'personal' ? t('seriesPersonal') : t('seriesEbbinghaus')
          }
        />
        <Line
          type="monotone"
          dataKey="reference"
          stroke={REFERENCE_COLOR}
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="personal"
          stroke={SERIES_COLOR}
          strokeWidth={2}
          connectNulls
          dot={{ r: 4, fill: SERIES_COLOR }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

interface HourBarChartProps {
  hours: HourPoint[];
}

/**
 * Recall rate by time of day (single-hue magnitude bars).
 *
 * @param props - Hour buckets from the analytics API. / 時間帯別の成績。
 */
export function HourBarChart({ hours }: HourBarChartProps) {
  const t = useTranslations('vocabulary.analytics');
  const data = hours.map((h) => ({
    label: t(`periods.${h.key}`),
    rate: h.rate,
    samples: h.samples,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 16, bottom: 0, left: -16 }}
        barCategoryGap="28%"
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} className="fill-zinc-500" />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 11 }}
          className="fill-zinc-500"
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          cursor={{ fill: 'rgba(113, 113, 122, 0.08)' }}
          contentStyle={TOOLTIP_STYLE}
          formatter={
            ((value: unknown, _n: unknown, entry: { payload?: { samples?: number } }) => [
              value == null
                ? t('noData')
                : `${value}% (${t('sampleCount', { count: entry.payload?.samples ?? 0 })})`,
              t('recallRate'),
            ]) as never
          }
        />
        <Bar dataKey="rate" fill={SERIES_COLOR} radius={[4, 4, 0, 0]} maxBarSize={56} />
      </BarChart>
    </ResponsiveContainer>
  );
}
