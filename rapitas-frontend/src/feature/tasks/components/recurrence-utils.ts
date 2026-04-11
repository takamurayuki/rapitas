/**
 * recurrence-utils
 *
 * Pure utility functions and constants for task recurrence.
 * Responsible for building RRULE strings and producing human-readable
 * descriptions of recurrence rules.
 * Not responsible for API calls or UI rendering.
 */

/** Days of the week used for custom RRULE BYDAY selection. */
export const WEEKDAYS = [
  { key: 'MO', label: '月' },
  { key: 'TU', label: '火' },
  { key: 'WE', label: '水' },
  { key: 'TH', label: '木' },
  { key: 'FR', label: '金' },
  { key: 'SA', label: '土' },
  { key: 'SU', label: '日' },
] as const;

/** Weekday keys that constitute the Monday–Friday business-day set. */
const WEEKDAY_KEYS = ['MO', 'TU', 'WE', 'TH', 'FR'] as const;

/**
 * Build a custom RRULE string from UI selections.
 *
 * @param freq - Recurrence frequency / 繰り返し頻度
 * @param interval - Repeat interval (every N periods) / 間隔（N期間ごと）
 * @param selectedDays - Selected weekday keys for WEEKLY frequency / 週次の場合の曜日キー
 * @returns RRULE-compatible string / RRULE互換文字列
 */
export function buildCustomRule(
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY',
  interval: number,
  selectedDays: string[],
): string {
  let rule = `FREQ=${freq};INTERVAL=${interval}`;
  if (freq === 'WEEKLY' && selectedDays.length > 0) {
    rule += `;BYDAY=${selectedDays.join(',')}`;
  }
  return rule;
}

/**
 * Parse an RRULE string and return a human-readable Japanese description.
 *
 * @param rule - RRULE string or null / RRULE文字列またはnull
 * @returns Localized description / 日本語の説明文字列
 */
export function describeRule(rule: string | null): string {
  if (!rule) return '繰り返しなし';

  const parts = rule.split(';');
  const freq = parts.find((p) => p.startsWith('FREQ='))?.split('=')[1];
  const interval = parseInt(
    parts.find((p) => p.startsWith('INTERVAL='))?.split('=')[1] ?? '1',
  );
  const byday = parts.find((p) => p.startsWith('BYDAY='))?.split('=')[1];

  switch (freq) {
    case 'DAILY':
      return interval > 1 ? `${interval}日ごと` : '毎日';
    case 'WEEKLY': {
      if (byday) {
        const days = byday.split(',');
        // Detect Monday–Friday shorthand
        if (days.length === 5 && WEEKDAY_KEYS.every((d) => days.includes(d))) {
          return '平日';
        }
        const dayLabels = days
          .map((d) => WEEKDAYS.find((w) => w.key === d)?.label)
          .filter(Boolean);
        return interval > 1
          ? `${interval}週ごと (${dayLabels.join(', ')})`
          : `毎週 ${dayLabels.join(', ')}`;
      }
      return interval > 1 ? `${interval}週ごと` : '毎週';
    }
    case 'MONTHLY':
      return interval > 1 ? `${interval}ヶ月ごと` : '毎月';
    case 'YEARLY':
      return interval > 1 ? `${interval}年ごと` : '毎年';
    default:
      return rule;
  }
}
