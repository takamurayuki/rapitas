/**
 * schedule-utils
 *
 * Pure utility functions for the schedule event dialog.
 * Responsible for default time calculation and UTC ISO string conversion.
 * Not responsible for UI rendering or API calls.
 */

/**
 * Get smart default start/end times based on the current wall-clock time.
 * Rounds up to the next 30-minute slot and sets end time 1 hour later.
 *
 * @returns Object with `start` and `end` in "HH:MM" format / "HH:MM"形式の開始・終了時刻
 */
export function getDefaultTimes(): { start: string; end: string } {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMin = now.getMinutes();

  // Round up to next 30-min slot
  let startHour = currentHour;
  let startMin = currentMin <= 30 ? 30 : 0;
  if (currentMin > 30) startHour += 1;

  // Wrap around midnight; fall back to 09:00 if past end of day
  if (startHour >= 24) {
    startHour = 9;
    startMin = 0;
  }

  const endHour = (startHour + 1) % 24; // NOTE: wraps midnight (e.g. 23:xx → 00:xx)

  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    start: `${pad(startHour)}:${pad(startMin)}`,
    end: `${pad(endHour)}:${pad(startMin)}`,
  };
}

/**
 * Convert a local date string and optional time string to a UTC ISO 8601 string.
 * Uses Date.UTC to avoid local-timezone skew.
 *
 * @param dateStr - Date in "YYYY-MM-DD" format / "YYYY-MM-DD"形式の日付
 * @param timeStr - Time in "HH:MM" format, defaults to "00:00" / "HH:MM"形式の時刻（省略時00:00）
 * @returns UTC ISO string / UTC ISO文字列
 */
export function toUTCISO(dateStr: string, timeStr: string = '00:00'): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, min] = timeStr.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, min, 0)).toISOString();
}

/**
 * Calculate the number of calendar days spanned by a date range (inclusive).
 *
 * @param startDate - Start date string "YYYY-MM-DD" / 開始日文字列
 * @param endDate - End date string "YYYY-MM-DD" / 終了日文字列
 * @returns Number of days (minimum 1) / 日数（最小1）
 */
export function calcDayCount(startDate: string, endDate: string): number {
  if (endDate <= startDate) return 1;
  return (
    Math.ceil(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) /
        (1000 * 60 * 60 * 24),
    ) + 1
  );
}

/**
 * Compute the end ISO string for a same-day or multi-day event.
 * Handles midnight wrap-around (e.g. start 23:00, end 02:00 → next day).
 *
 * @param startDate - Start date "YYYY-MM-DD" / 開始日
 * @param endDate - End date "YYYY-MM-DD" / 終了日
 * @param startTime - Start time "HH:MM" / 開始時刻
 * @param endTime - End time "HH:MM" / 終了時刻
 * @param isAllDay - Whether the event spans full days / 終日イベントか
 * @param isMultiDay - Whether a multi-day range is selected / 複数日選択か
 * @returns UTC ISO end string, or undefined for all-day single-day events / UTC終了日時またはundefined
 */
export function resolveEndAt(
  startDate: string,
  endDate: string,
  startTime: string,
  endTime: string,
  isAllDay: boolean,
  isMultiDay: boolean,
): string | undefined {
  if (isAllDay) {
    if (isMultiDay && endDate > startDate) {
      // All-day multi-day events end at 00:00 the day after the last day
      const nextDay = new Date(endDate);
      nextDay.setDate(nextDay.getDate() + 1);
      const [year, month, day] = nextDay.toISOString().split('T')[0].split('-').map(Number);
      return new Date(Date.UTC(year, month - 1, day, 0, 0, 0)).toISOString();
    }
    return undefined;
  }

  if (isMultiDay && endDate >= startDate) {
    return toUTCISO(endDate, endTime);
  }

  // Single-day: if end time is before start time, treat as wrapping to next day
  const [startH] = startTime.split(':').map(Number);
  const [endH] = endTime.split(':').map(Number);
  if (endH < startH) {
    const nextDay = new Date(startDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const [year, month, day] = nextDay.toISOString().split('T')[0].split('-').map(Number);
    const [hour, min] = endTime.split(':').map(Number);
    return new Date(Date.UTC(year, month - 1, day, hour, min, 0)).toISOString();
  }

  return toUTCISO(startDate, endTime);
}
