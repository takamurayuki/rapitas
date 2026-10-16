/**
 * recurrence-utils
 *
 * Pure utility functions and constants for task recurrence.
 * Responsible for building RRULE strings and producing human-readable
 * descriptions of recurrence rules.
 * Not responsible for API calls or UI rendering.
 */

/** Translator shape accepted by describeRule. */
type TFunc = (key: string, values?: Record<string, string | number>) => string;

// NOTE: labelKey is an i18n key into the `task` namespace — resolve via
// t(day.labelKey) at render time rather than reading `.label` directly.
/** Days of the week used for custom RRULE BYDAY selection. */
export const WEEKDAYS = [
  { key: 'MO', labelKey: 'weekday.mon' },
  { key: 'TU', labelKey: 'weekday.tue' },
  { key: 'WE', labelKey: 'weekday.wed' },
  { key: 'TH', labelKey: 'weekday.thu' },
  { key: 'FR', labelKey: 'weekday.fri' },
  { key: 'SA', labelKey: 'weekday.sat' },
  { key: 'SU', labelKey: 'weekday.sun' },
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
 * Parse an RRULE string and return a human-readable description.
 *
 * @param rule - RRULE string or null / RRULE文字列またはnull
 * @param t - Translator bound to the `task` namespace / `task` 名前空間の翻訳関数
 * @returns Localized description / 翻訳済みの説明文字列
 */
export function describeRule(rule: string | null, t: TFunc): string {
  if (!rule) return t('recurrenceDesc.none');

  const parts = rule.split(';');
  const freq = parts.find((p) => p.startsWith('FREQ='))?.split('=')[1];
  const interval = parseInt(parts.find((p) => p.startsWith('INTERVAL='))?.split('=')[1] ?? '1');
  const byday = parts.find((p) => p.startsWith('BYDAY='))?.split('=')[1];

  switch (freq) {
    case 'DAILY':
      return interval > 1
        ? t('recurrenceDesc.dailyInterval', { interval })
        : t('recurrenceDesc.daily');
    case 'WEEKLY': {
      if (byday) {
        const days = byday.split(',');
        // Detect Monday–Friday shorthand
        if (days.length === 5 && WEEKDAY_KEYS.every((d) => days.includes(d))) {
          return t('recurrenceDesc.weekdaysOnly');
        }
        const dayLabels = days
          .map((d) => WEEKDAYS.find((w) => w.key === d))
          .filter((w): w is (typeof WEEKDAYS)[number] => Boolean(w))
          .map((w) => t(w.labelKey));
        return interval > 1
          ? t('recurrenceDesc.weeklyIntervalWithDays', { interval, days: dayLabels.join(', ') })
          : t('recurrenceDesc.weeklyWithDays', { days: dayLabels.join(', ') });
      }
      return interval > 1
        ? t('recurrenceDesc.weeklyInterval', { interval })
        : t('recurrenceDesc.weekly');
    }
    case 'MONTHLY':
      return interval > 1
        ? t('recurrenceDesc.monthlyInterval', { interval })
        : t('recurrenceDesc.monthly');
    case 'YEARLY':
      return interval > 1
        ? t('recurrenceDesc.yearlyInterval', { interval })
        : t('recurrenceDesc.yearly');
    default:
      return rule;
  }
}
