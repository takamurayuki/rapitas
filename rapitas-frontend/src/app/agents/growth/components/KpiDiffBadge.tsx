'use client';
// KpiDiffBadge

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { resolveKpiDiffTone, type KpiDiff, type KpiDiffTone } from './retro-kpi-points';

interface KpiDiffBadgeProps {
  diff: KpiDiff;
  /** Period label shown after the delta (e.g. 先週比). */
  label: string;
  /** Series label shown before the delta when a card carries several badges. */
  seriesLabel?: string;
  valueFormat: 'percent' | 'count' | 'minutes';
}

// Improvement is always green and regression always red, independent of the
// arrow direction — a falling repair rate must not read as bad news.
const TONE_CLASS: Record<KpiDiffTone, string> = {
  improved: 'text-green-600 dark:text-green-400',
  worsened: 'text-red-600 dark:text-red-400',
  neutral: 'text-zinc-500 dark:text-zinc-400',
};

/**
 * Formats a signed delta in the series' unit. Percent series are shown as
 * percentage-point deltas (34% → 30% is "-4.0pt"), not relative change.
 *
 * @param delta - current minus previous. / 今週−先週
 * @param valueFormat - Unit of the series. / 系列の単位
 * @returns Signed delta text. / 符号付き差分文字列
 */
function formatDelta(delta: number, valueFormat: KpiDiffBadgeProps['valueFormat']): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '±';
  const abs = Math.abs(delta);
  if (valueFormat === 'percent') return `${sign}${(abs * 100).toFixed(1)}pt`;
  if (valueFormat === 'minutes') return `${sign}${abs.toFixed(0)}分`;
  return `${sign}${abs}`;
}

/**
 * This-week vs last-week delta badge for one KPI series. Renders nothing when
 * either week has no value, so an empty ledger never shows a fabricated zero.
 *
 * @param props - Diff, labels and unit formatting.
 */
export function KpiDiffBadge({ diff, label, seriesLabel, valueFormat }: KpiDiffBadgeProps) {
  if (diff.currentValue === null || diff.previousValue === null) return null;
  const delta = diff.currentValue - diff.previousValue;
  const tone = resolveKpiDiffTone(diff);
  const Arrow = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;

  return (
    <span
      data-testid="kpi-diff-badge"
      data-tone={tone}
      className={`inline-flex items-center gap-0.5 whitespace-nowrap text-xs ${TONE_CLASS[tone]}`}
    >
      {seriesLabel && (
        <span className="mr-0.5 text-zinc-500 dark:text-zinc-400">{seriesLabel}</span>
      )}
      <Arrow className="h-3 w-3 shrink-0" />
      {formatDelta(delta, valueFormat)}
      <span className="ml-0.5 text-zinc-500 dark:text-zinc-400">{label}</span>
    </span>
  );
}
