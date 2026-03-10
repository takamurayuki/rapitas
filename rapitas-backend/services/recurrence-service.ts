/**
 * Recurrence Service
 * RRULE形式の繰り返しルールを解析し、イベントインスタンスを仮想展開
 */

export interface RRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  byday?: string[]; // MO, TU, WE, TH, FR, SA, SU
  bymonthday?: number[];
  count?: number;
  until?: Date;
}

const DAY_MAP: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

/**
 * RRULE文字列をパース
 * 例: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR"
 */
export function parseRRule(rule: string): RRule {
  const parts = rule.split(';');
  const result: RRule = { freq: 'DAILY', interval: 1 };

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (!key || !value) continue;

    switch (key) {
      case 'FREQ':
        result.freq = value as RRule['freq'];
        break;
      case 'INTERVAL':
        result.interval = parseInt(value);
        break;
      case 'BYDAY':
        result.byday = value.split(',');
        break;
      case 'BYMONTHDAY':
        result.bymonthday = value.split(',').map(Number);
        break;
      case 'COUNT':
        result.count = parseInt(value);
        break;
      case 'UNTIL':
        result.until = new Date(value);
        break;
    }
  }

  return result;
}

/**
 * RRULE オブジェクトを文字列にシリアライズ
 */
export function serializeRRule(rule: RRule): string {
  const parts: string[] = [`FREQ=${rule.freq}`];

  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byday?.length) parts.push(`BYDAY=${rule.byday.join(',')}`);
  if (rule.bymonthday?.length) parts.push(`BYMONTHDAY=${rule.bymonthday.join(',')}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  if (rule.until) parts.push(`UNTIL=${rule.until.toISOString()}`);

  return parts.join(';');
}

/**
 * 繰り返しルールに基づいて日付リストを生成
 */
export function expandRecurrence(
  startDate: Date,
  rule: RRule,
  rangeStart: Date,
  rangeEnd: Date,
  recurrenceEnd?: Date | null,
  maxOccurrences: number = 365,
): Date[] {
  const dates: Date[] = [];
  const effectiveEnd = recurrenceEnd
    ? new Date(Math.min(rangeEnd.getTime(), recurrenceEnd.getTime()))
    : rangeEnd;

  if (rule.until) {
    const untilTime = rule.until.getTime();
    if (untilTime < rangeStart.getTime()) return dates;
  }

  let current = new Date(startDate);
  let count = 0;

  while (current <= effectiveEnd && count < maxOccurrences) {
    if (rule.count && count >= rule.count) break;
    if (rule.until && current > rule.until) break;

    if (current >= rangeStart) {
      if (rule.freq === 'WEEKLY' && rule.byday?.length) {
        // 週の特定曜日
        const dayOfWeek = current.getDay();
        const dayName = Object.entries(DAY_MAP).find(([, v]) => v === dayOfWeek)?.[0];
        if (dayName && rule.byday.includes(dayName)) {
          dates.push(new Date(current));
          count++;
        }
      } else if (rule.freq === 'MONTHLY' && rule.bymonthday?.length) {
        // 月の特定日
        if (rule.bymonthday.includes(current.getDate())) {
          dates.push(new Date(current));
          count++;
        }
      } else {
        dates.push(new Date(current));
        count++;
      }
    }

    // 次の日付に進む
    switch (rule.freq) {
      case 'DAILY':
        current.setDate(current.getDate() + rule.interval);
        break;
      case 'WEEKLY':
        if (rule.byday?.length) {
          // 次の曜日に進む
          current.setDate(current.getDate() + 1);
          // 週をまたぐ場合はintervalを考慮
          const startDay = startDate.getDay();
          if (current.getDay() === startDay && rule.interval > 1) {
            current.setDate(current.getDate() + 7 * (rule.interval - 1));
          }
        } else {
          current.setDate(current.getDate() + 7 * rule.interval);
        }
        break;
      case 'MONTHLY':
        if (rule.bymonthday?.length) {
          current.setDate(current.getDate() + 1);
        } else {
          current.setMonth(current.getMonth() + rule.interval);
        }
        break;
      case 'YEARLY':
        current.setFullYear(current.getFullYear() + rule.interval);
        break;
    }
  }

  return dates;
}

/**
 * よく使う繰り返しパターンのプリセット
 */
export const RECURRENCE_PRESETS = {
  daily: 'FREQ=DAILY;INTERVAL=1',
  weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  weekly: 'FREQ=WEEKLY;INTERVAL=1',
  biweekly: 'FREQ=WEEKLY;INTERVAL=2',
  monthly: 'FREQ=MONTHLY;INTERVAL=1',
  yearly: 'FREQ=YEARLY;INTERVAL=1',
} as const;
