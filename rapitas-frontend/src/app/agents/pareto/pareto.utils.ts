/**
 * pareto.utils
 *
 * Pure formatting/query helpers for the efficiency-frontier dashboard:
 * query-string construction, number formatting, and confidence-interval
 * labels. No React, no I/O.
 */

import type { IntervalEstimate, ParetoGoal, ParetoQueryFilters } from './types';

/** Default trailing window (matches the task's 30-day requirement). */
export const DEFAULT_WINDOW_DAYS = 30;

/** Window sizes offered by the filter bar. */
export const WINDOW_DAY_OPTIONS = [7, 14, 30, 60, 90] as const;

/** Roles offered by the filter bar (`all` first). */
export const ROLE_OPTIONS = [
  'all',
  'researcher',
  'planner',
  'implementer',
  'verifier',
  'auto_verifier',
] as const;

/**
 * Builds the shared query string for both endpoints.
 *
 * @param filters - Client filter state / フィルタ
 * @param goal - Optional goal appended for the recommend endpoint / 目標
 * @returns URL query string without the leading `?` / クエリ文字列
 */
export function buildParetoQuery(filters: ParetoQueryFilters, goal?: ParetoGoal): string {
  const params = new URLSearchParams({
    days: String(filters.days),
    complexityBand: filters.complexityBand,
    role: filters.role,
  });
  if (goal) {
    params.set('goal', goal.kind);
    params.set('value', String(goal.value));
  }
  return params.toString();
}

/**
 * Milliseconds to seconds with one decimal.
 *
 * @param ms - Milliseconds / ミリ秒
 * @returns Seconds / 秒
 */
export function toSeconds(ms: number): number {
  return Math.round(ms / 100) / 10;
}

/**
 * Formats a USD amount with 4 decimals (per-execution costs are small).
 *
 * @param usd - Amount / 金額
 * @returns e.g. `$0.1234` / 表示文字列
 */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/**
 * Formats a signed delta so improvements and regressions are distinguishable.
 *
 * @param value - Delta / 差分
 * @param digits - Decimal digits / 小数桁
 * @param suffix - Unit suffix / 単位
 * @returns e.g. `+12.5%`, `-3.0h` / 表示文字列
 */
export function formatSigned(value: number, digits = 1, suffix = ''): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}${suffix}`;
}

/**
 * Renders `value [low – high]` for a confidence interval.
 *
 * @param estimate - Interval estimate / 区間推定
 * @param format - Per-number formatter / 数値整形
 * @returns Label / 表示文字列
 */
export function formatInterval(
  estimate: IntervalEstimate,
  format: (v: number) => string = (v) => v.toFixed(1),
): string {
  return `${format(estimate.value)} [${format(estimate.ciLow)} – ${format(estimate.ciHigh)}]`;
}

/**
 * Half-widths below/above the point estimate, as recharts ErrorBar expects.
 *
 * @param estimate - Interval estimate / 区間推定
 * @param scale - Unit conversion applied to each bound / 単位変換
 * @returns `[below, above]` / 下側・上側の幅
 */
export function errorBarRange(
  estimate: IntervalEstimate,
  scale: (v: number) => number = (v) => v,
): [number, number] {
  const value = scale(estimate.value);
  return [Math.max(0, value - scale(estimate.ciLow)), Math.max(0, scale(estimate.ciHigh) - value)];
}
