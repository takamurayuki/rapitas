/**
 * usage-budget-math
 *
 * Pure functions for the AI usage budget: local month/day keys under a client
 * timezone offset, threshold levels, the trailing 7-day average, forecasts,
 * input validation and the suggested initial shares. No I/O.
 */
import {
  TZ_OFFSET_MAX,
  TZ_OFFSET_MIN,
  type BudgetConfig,
  type BudgetLevel,
  type BudgetProjection,
  type ExecutionUsageSample,
  type ThemeShare,
  type UsageBudgetUnit,
} from './usage-budget-types';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const AVG_WINDOW_DAYS = 7;

/**
 * Parse the `tzOffsetMinutes` query value.
 *
 * @param raw - Raw query value / クエリの生値
 * @returns Offset in minutes (0 when absent), or null when invalid / 分単位のオフセット（不正時は null）
 */
export function parseTzOffset(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < TZ_OFFSET_MIN || n > TZ_OFFSET_MAX) return null;
  return n;
}

/** Shift an instant so its UTC fields read as the client's local wall clock. */
function toLocal(at: Date, tzOffsetMinutes: number): Date {
  return new Date(at.getTime() + tzOffsetMinutes * MINUTE_MS);
}

/**
 * Local calendar date (YYYY-MM-DD) of an instant.
 *
 * @param at - Instant / 時刻
 * @param tzOffsetMinutes - Client offset east of UTC / UTC からのオフセット（分）
 * @returns Local date key / ローカル日付キー
 */
export function localDateKey(at: Date, tzOffsetMinutes: number): string {
  return toLocal(at, tzOffsetMinutes).toISOString().slice(0, 10);
}

/**
 * Local month (YYYY-MM) of an instant.
 *
 * @param now - Instant / 時刻
 * @param tzOffsetMinutes - Client offset east of UTC / UTC からのオフセット（分）
 * @returns Month key / 月キー
 */
export function monthKey(now: Date, tzOffsetMinutes: number): string {
  return localDateKey(now, tzOffsetMinutes).slice(0, 7);
}

/**
 * Bounds of the current local month.
 *
 * @param now - Current instant / 現在時刻
 * @param tzOffsetMinutes - Client offset east of UTC / UTC からのオフセット（分）
 * @returns UTC instant of the local month start, its length and the days left after today / 月初の UTC 時刻・日数・今日より後の残日数
 */
export function monthWindow(
  now: Date,
  tzOffsetMinutes: number,
): { start: Date; daysInMonth: number; daysLeftInMonth: number } {
  const local = toLocal(now, tzOffsetMinutes);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1) - tzOffsetMinutes * MINUTE_MS);
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { start, daysInMonth, daysLeftInMonth: daysInMonth - local.getUTCDate() };
}

/**
 * Start (UTC instant) of the local day `daysBack` days before today.
 *
 * @param now - Current instant / 現在時刻
 * @param tzOffsetMinutes - Client offset east of UTC / UTC からのオフセット（分）
 * @param daysBack - 0 = today / 何日前か
 * @returns UTC instant of that local midnight / ローカル0時の UTC 時刻
 */
export function localDayStart(now: Date, tzOffsetMinutes: number, daysBack: number): Date {
  const local = toLocal(now, tzOffsetMinutes);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnight - daysBack * DAY_MS - tzOffsetMinutes * MINUTE_MS);
}

/**
 * Token count of one execution: tokensUsed when recorded, else input + output.
 *
 * @param row - Token columns of an AgentExecution / トークン列
 * @returns Token count / トークン数
 */
export function resolveExecutionTokens(row: {
  tokensUsed: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}): number {
  const used = row.tokensUsed ?? 0;
  if (used > 0) return used;
  return (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
}

/**
 * Contribution of one execution to the budget in the given unit.
 *
 * @param s - Execution sample / 実行サンプル
 * @param unit - Budget unit / 予算単位
 * @returns Tokens, or 1 per execution / トークン数または 1
 */
export function sampleUsage(s: ExecutionUsageSample, unit: UsageBudgetUnit): number {
  return unit === 'tokens' ? s.tokens : 1;
}

/**
 * Highest threshold level reached. Integer comparison only, so float rounding
 * can never move a boundary (used×10 ≥ limit×8 is 80%).
 *
 * @param used - Usage this month / 当月使用量
 * @param limit - Monthly limit / 月間上限
 * @returns Level / 到達水準
 */
export function determineLevel(used: number, limit: number): BudgetLevel {
  if (limit <= 0) return 'none';
  if (used >= limit) return 'exceeded';
  if (used * 10 >= limit * 9) return 'warn90';
  if (used * 10 >= limit * 8) return 'warn80';
  return 'none';
}

/**
 * Trailing 7-day daily average (today included). The denominator is the number
 * of days from the first active day inside the window to today, capped at 7
 * and at least 1, so a fresh install does not under-forecast.
 *
 * @param samples - Executions (any range; filtered here) / 実行サンプル
 * @param unit - Budget unit / 予算単位
 * @param now - Current instant / 現在時刻
 * @param tzOffsetMinutes - Client offset / オフセット（分）
 * @returns Average per day, 0 when the window is empty / 1日平均
 */
export function computeAvg7(
  samples: ExecutionUsageSample[],
  unit: UsageBudgetUnit,
  now: Date,
  tzOffsetMinutes: number,
): number {
  const windowStart = localDayStart(now, tzOffsetMinutes, AVG_WINDOW_DAYS - 1).getTime();
  const end = now.getTime();
  let total = 0;
  let firstAt: number | null = null;
  for (const s of samples) {
    const t = s.at.getTime();
    if (t < windowStart || t > end) continue;
    total += sampleUsage(s, unit);
    if (firstAt === null || t < firstAt) firstAt = t;
  }
  if (firstAt === null) return 0;
  const firstDayStart = localDayStart(new Date(firstAt), tzOffsetMinutes, 0).getTime();
  const todayStart = localDayStart(now, tzOffsetMinutes, 0).getTime();
  const activeDays = Math.round((todayStart - firstDayStart) / DAY_MS) + 1;
  const denom = Math.max(1, Math.min(AVG_WINDOW_DAYS, activeDays));
  return total / denom;
}

/**
 * Progress and forecast for the month.
 *
 * @param p - used / limit / avg7 / daysLeftInMonth / 入力値
 * @returns Projection / 進捗と予測
 */
export function computeProjection(p: {
  used: number;
  limit: number;
  avg7: number;
  daysLeftInMonth: number;
}): BudgetProjection {
  const remaining = Math.max(0, p.limit - p.used);
  const hasRate = p.avg7 > 0;
  return {
    used: p.used,
    limit: p.limit,
    remaining,
    ratio: p.limit > 0 ? p.used / p.limit : 0,
    level: determineLevel(p.used, p.limit),
    avg7: p.avg7,
    daysToExhaust: hasRate ? remaining / p.avg7 : null,
    projectedMonthEnd: hasRate ? p.used + p.avg7 * p.daysLeftInMonth : null,
    daysLeftInMonth: p.daysLeftInMonth,
  };
}

/**
 * Notification / acknowledgement key for a level in a month.
 *
 * @param month - YYYY-MM / 月キー
 * @param level - Level / 水準
 * @returns `YYYY-MM:<level>` / キー
 */
export function levelKey(month: string, level: BudgetLevel): string {
  return `${month}:${level}`;
}

/**
 * Whether the threshold dialog should be shown now.
 *
 * @param cfg - Budget config / 予算設定
 * @param level - Current level / 現在水準
 * @param key - Current level key / 現在キー
 * @param now - Current instant / 現在時刻
 * @returns true when not none, not acknowledged and not snoozed / 表示すべきなら true
 */
export function shouldPrompt(
  cfg: BudgetConfig,
  level: BudgetLevel,
  key: string,
  now: Date,
): boolean {
  if (level === 'none') return false;
  if (cfg.acknowledgedKey === key) return false;
  if (cfg.snoozedUntil && cfg.snoozedUntil.getTime() > now.getTime()) return false;
  return true;
}

/**
 * Validate a monthly limit (positive integer).
 *
 * @param v - Candidate value / 候補値
 * @returns Error message, or null when valid / エラー文言（妥当なら null）
 */
export function validateMonthlyLimit(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
    return 'monthlyLimit must be a positive integer';
  }
  return null;
}

/**
 * Validate share percentages: each 0–100, unique non-negative integer themeIds,
 * total at most 100 (the remainder is unallocated).
 *
 * @param shares - Candidate shares / 候補の配分
 * @returns Error message, or null when valid / エラー文言（妥当なら null）
 */
export function validateShares(shares: ThemeShare[]): string | null {
  const seen = new Set<number>();
  let total = 0;
  for (const s of shares) {
    if (!Number.isInteger(s.themeId) || s.themeId < 0) return 'themeId must be an integer ≥ 0';
    if (seen.has(s.themeId)) return `duplicate themeId ${s.themeId}`;
    seen.add(s.themeId);
    if (!Number.isFinite(s.sharePercent) || s.sharePercent < 0 || s.sharePercent > 100) {
      return 'sharePercent must be between 0 and 100';
    }
    total += s.sharePercent;
  }
  // Epsilon absorbs float noise from e.g. 33.3 + 33.3 + 33.4.
  if (total > 100 + 1e-9) return 'sharePercent total must not exceed 100';
  return null;
}

/**
 * Suggested initial shares proportional to usage. Floored to 0.1 so the total
 * never exceeds 100; highest share first.
 *
 * @param usageByTheme - Usage per themeId / テーマ別使用量
 * @returns Suggested shares (empty when no usage) / 提案配分
 */
export function suggestShares(
  usageByTheme: Map<number, number>,
): Array<{ themeId: number; sharePercent: number }> {
  let total = 0;
  for (const v of usageByTheme.values()) total += Math.max(0, v);
  if (total <= 0) return [];
  return Array.from(usageByTheme.entries())
    .filter(([, v]) => v > 0)
    .map(([themeId, v]) => ({ themeId, sharePercent: Math.floor((v / total) * 1000) / 10 }))
    .sort((a, b) => b.sharePercent - a.sharePercent || a.themeId - b.themeId);
}
