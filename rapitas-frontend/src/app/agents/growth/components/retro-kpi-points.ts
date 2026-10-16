/**
 * retro-kpi-points
 *
 * Pure shaping helpers for the retro KPI section: turns API windows (newest
 * first) into chart points (oldest first) and computes this-week vs last-week
 * diffs. Not responsible for fetching or rendering.
 */
import type { ImprovementDirection, RetroKpiWindow } from '../types';
import type { WeeklyMetricPoint } from './WeeklyMetricChart';

/** This-week vs last-week comparison for one KPI series. */
export interface KpiDiff {
  /** Newest window value; null when the ledger is empty or the value is null. */
  currentValue: number | null;
  /** Second-newest window value; null when fewer than two windows exist or the value is null. */
  previousValue: number | null;
  direction: ImprovementDirection;
}

/** Visual tone of a diff badge, derived from delta sign and improvement direction. */
export type KpiDiffTone = 'improved' | 'worsened' | 'neutral';

/**
 * Formats an ISO date string into a short M/D label for chart x-axis ticks.
 *
 * @param iso - ISO 8601 date string. / ISO日時文字列
 * @returns Short label, e.g. "3/20". / 月/日ラベル
 */
export function formatWeekLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Builds one chart's data points from ledger windows, oldest first.
 *
 * @param windows - Ledger windows, newest first (API order). / 新しい順の窓
 * @param pick - Extracts the series values for one window. / 系列値の抽出関数
 * @returns Chart-ready points, oldest week first. / 古い順のチャート点
 */
export function toRetroKpiPoints(
  windows: RetroKpiWindow[],
  pick: (w: RetroKpiWindow) => Omit<WeeklyMetricPoint, 'weekLabel'>,
): WeeklyMetricPoint[] {
  return [...windows].reverse().map((w) => ({ weekLabel: formatWeekLabel(w.to), ...pick(w) }));
}

/**
 * Compares the newest window (this week) with the second-newest (last week).
 * Missing windows or null values propagate as null so the badge can hide
 * itself instead of inventing a zero.
 *
 * @param windows - Ledger windows, newest first (API order). / 新しい順の窓
 * @param pick - Extracts the compared value for one window. / 比較値の抽出関数
 * @param direction - Which way is an improvement for this KPI. / 改善方向
 * @returns Current/previous values plus the direction. / 今週・先週の値と改善方向
 */
export function computeKpiDiff(
  windows: RetroKpiWindow[],
  pick: (w: RetroKpiWindow) => number | null,
  direction: ImprovementDirection,
): KpiDiff {
  const current = windows[0];
  const previous = windows[1];
  return {
    currentValue: current ? pick(current) : null,
    previousValue: previous ? pick(previous) : null,
    direction,
  };
}

/**
 * Resolves the badge tone: improvement is green regardless of whether the
 * number went up or down, so a falling repair rate and a rising merge count
 * both read as good news. Equal values and `neutral` series stay grey.
 *
 * @param diff - Comparison to classify. / 分類対象の比較結果
 * @returns Tone for colouring the badge. / バッジの色調
 */
export function resolveKpiDiffTone(diff: KpiDiff): KpiDiffTone {
  if (diff.currentValue === null || diff.previousValue === null) return 'neutral';
  const delta = diff.currentValue - diff.previousValue;
  if (delta === 0 || diff.direction === 'neutral') return 'neutral';
  const improved = diff.direction === 'higher_is_better' ? delta > 0 : delta < 0;
  return improved ? 'improved' : 'worsened';
}
