/**
 * duration
 *
 * Formatting helpers for decimal-hour durations (task/subtask estimates and
 * actuals). Display rule (operator decision 2026-09-03): under one hour show
 * whole minutes ("40m"), one hour and over show hours truncated to one
 * decimal ("1.5h"). Truncation, never rounding — time worked must not be
 * overstated.
 */

/**
 * Format a decimal-hour value compactly: minutes under 1h, hours from 1h.
 *
 * @param hours - Duration in decimal hours (e.g. 0.423, 1.5) / 10進の時間
 * @returns "40m" style under one hour, "1.5h" style otherwise / 60分未満はm表記、以上はh表記
 */
export function formatHoursCompact(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '0m';
  if (hours < 1) return `${Math.floor(hours * 60)}m`;
  return `${Math.floor(hours * 10) / 10}h`;
}
