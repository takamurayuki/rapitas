/**
 * Error Analytics Service
 *
 * Reads daily pino warn/error/fatal log files and produces categorised
 * aggregations + week-over-week comparisons for the error analytics dashboard.
 * Does NOT write to the database — the daily log files produced by
 * config/logger.ts:createDailyWarnSink() are the sole source of truth.
 */

import { existsSync, readFileSync } from 'fs';
import { getBackendLogFilePath } from '../../config/logger';

// ---- Types ------------------------------------------------------------------

export interface ErrorCategoryDef {
  name: string;
  label: string;
  patterns: RegExp[];
}

export interface CategoryStats {
  name: string;
  label: string;
  totalCount: number;
  sharePercent: number;
  currentWeek: number;
  previousWeek: number;
  deltaCount: number;
  deltaPercent: number | null;
  topMessages: { msg: string; count: number }[];
}

export interface DailyTrendEntry {
  date: string;
  counts: Record<string, number>;
}

export interface ErrorAnalyticsResult {
  categories: CategoryStats[];
  total: {
    count: number;
    currentWeek: number;
    previousWeek: number;
    deltaCount: number;
    deltaPercent: number | null;
  };
  dailyTrend: DailyTrendEntry[];
  availableDays: number;
  unclassified: number;
}

interface ParsedLogLine {
  level: number;
  time: number;
  msg: string;
  name?: string;
}

// ---- Constants --------------------------------------------------------------

const MAX_LINES_PER_FILE = 5_000;
const TOP_MESSAGES_LIMIT = 5;

/**
 * Known-benign log messages to exclude from analytics.
 * Mirrors cli-output-filter.ts BENIGN_DIAGNOSTIC_PATTERNS (inlined to avoid
 * circular imports — this service is in `services/system`, not `services/agents`).
 */
const BENIGN_PATTERNS: RegExp[] = [
  /codex_core::session: failed to record rollout/i,
  /failed to record rollout/i,
  /failed to clean up stale arg0 temp dirs/i,
  /proceeding, even though we could not update PATH/i,
];

/**
 * Error categories ordered by specificity (most specific first).
 * A log line is assigned the first category whose pattern matches.
 */
export const ERROR_CATEGORIES: ErrorCategoryDef[] = [
  {
    name: 'GH_CLI',
    label: 'GitHub CLI エラー',
    patterns: [/gh command failed/i, /gh: error/i, /gh auth/i],
  },
  {
    name: 'WORKER',
    label: 'ワーカー起動',
    patterns: [/Worker not ready/i, /Startup recovery skipped/i, /worker.*fail/i],
  },
  {
    name: 'JSON_PARSE',
    label: 'JSON パース',
    patterns: [/JSON parse/i, /JSON\.parse/i, /Unexpected token.*JSON/i, /invalid json/i],
  },
  {
    name: 'DATABASE',
    label: 'データベース',
    patterns: [/P\d{4}/, /Prisma.*[Ee]rror/i, /ECONNREFUSED.*5432/i, /database.*error/i],
  },
  {
    name: 'NETWORK',
    label: 'ネットワーク',
    patterns: [/ECONNREFUSED/i, /ENOTFOUND/i, /Failed to fetch/i, /ERR_NETWORK/i],
  },
  {
    name: 'RATE_LIMIT',
    label: 'レート制限',
    patterns: [/rate.?limit/i, /quota exceeded/i, /\b429\b/, /too many requests/i],
  },
  {
    name: 'AUTH',
    label: '認証エラー',
    patterns: [/Unauthorized/i, /\b401\b/, /403 Forbidden/i, /auth.*failed/i, /token.*expired/i],
  },
  {
    name: 'TIMEOUT',
    label: 'タイムアウト',
    patterns: [/timeout/i, /ETIMEDOUT/i, /timed out/i],
  },
];

// ---- Internal helpers -------------------------------------------------------

/**
 * Compute a YYYY-MM-DD stamp for a date offset by `daysAgo` from now.
 *
 * @param daysAgo - Number of days back from today / 今日から何日前か
 * @returns YYYY-MM-DD stamp / 日付文字列
 */
export function stampForDaysAgo(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, '0')}-` +
    `${String(d.getDate()).padStart(2, '0')}`
  );
}

/**
 * Parse a single pino NDJSON log line.
 *
 * @param raw - Raw log line string / ログ行文字列
 * @returns Parsed object or null when the line is not valid warn/error/fatal JSON
 */
export function parsePinoLine(raw: string): ParsedLogLine | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (typeof obj !== 'object' || obj === null) return null;
    const level = typeof obj.level === 'number' ? obj.level : -1;
    // pino: warn=40, error=50, fatal=60 — only process warn and above
    if (level < 40) return null;
    const msg = typeof obj.msg === 'string' ? obj.msg : String(obj.msg ?? '');
    const time = typeof obj.time === 'number' ? obj.time : 0;
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    return { level, time, msg, name };
  } catch {
    return null;
  }
}

/**
 * True when a log message matches any known-benign suppression pattern.
 *
 * @param msg - Log message to evaluate / 評価するログメッセージ
 * @returns true when the message should be excluded from analytics
 */
export function isBenign(msg: string): boolean {
  return BENIGN_PATTERNS.some((p) => p.test(msg));
}

/**
 * Map a log message to an error category name, or 'UNCLASSIFIED'.
 *
 * @param msg - Log message / ログメッセージ
 * @returns Category name / カテゴリ名
 */
export function classifyMessage(msg: string): string {
  for (const cat of ERROR_CATEGORIES) {
    if (cat.patterns.some((p) => p.test(msg))) return cat.name;
  }
  return 'UNCLASSIFIED';
}

/**
 * Compute percentage delta between two counts.
 *
 * @param current - Current period count / 今週の件数
 * @param previous - Previous period count / 先週の件数
 * @returns Percentage change, or null when previous is 0
 */
export function computeDeltaPercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100 * 10) / 10;
}

// ---- Main API ---------------------------------------------------------------

/**
 * Read and aggregate error analytics from the last `days` daily log files.
 *
 * @param days - Number of past days to include (1–30) / 集計期間（日数）
 * @returns Categorised aggregations and trend data
 */
export function getErrorAnalytics(days: number): ErrorAnalyticsResult {
  const clampedDays = Math.max(1, Math.min(30, days));

  // currentWeek = index 0..6 (days ago), previousWeek = index 7..13
  const CURRENT_WEEK_DAYS = 7;

  // Per-category, per-day counts: categoryName → date → count
  const dayCounts: Map<string, Map<string, number>> = new Map();
  // Per-category message frequency: categoryName → msg → count
  const msgCounts: Map<string, Map<string, number>> = new Map();

  let availableDays = 0;
  let unclassified = 0;

  for (let i = 0; i < clampedDays; i++) {
    const stamp = stampForDaysAgo(i);
    const filePath = getBackendLogFilePath(stamp);

    if (!existsSync(filePath)) continue;
    availableDays++;

    let content = '';
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    const lineLimit = Math.min(lines.length, MAX_LINES_PER_FILE);

    for (let li = 0; li < lineLimit; li++) {
      const raw = lines[li].trim();
      if (!raw) continue;

      const entry = parsePinoLine(raw);
      if (!entry) continue;
      if (isBenign(entry.msg)) continue;

      const category = classifyMessage(entry.msg);

      if (category === 'UNCLASSIFIED') {
        unclassified++;
        continue;
      }

      // Accumulate day counts
      if (!dayCounts.has(category)) dayCounts.set(category, new Map());
      const catDays = dayCounts.get(category)!;
      catDays.set(stamp, (catDays.get(stamp) ?? 0) + 1);

      // Accumulate message frequency
      if (!msgCounts.has(category)) msgCounts.set(category, new Map());
      const catMsgs = msgCounts.get(category)!;
      // Truncate long messages for storage efficiency
      const key = entry.msg.slice(0, 200);
      catMsgs.set(key, (catMsgs.get(key) ?? 0) + 1);
    }
  }

  // Build per-category stats
  const categoryStats: CategoryStats[] = [];
  let grandTotal = 0;
  let grandCurrentWeek = 0;
  let grandPreviousWeek = 0;

  for (const def of ERROR_CATEGORIES) {
    const dayMap = dayCounts.get(def.name);
    if (!dayMap) {
      categoryStats.push({
        name: def.name,
        label: def.label,
        totalCount: 0,
        sharePercent: 0,
        currentWeek: 0,
        previousWeek: 0,
        deltaCount: 0,
        deltaPercent: null,
        topMessages: [],
      });
      continue;
    }

    let totalCount = 0;
    let currentWeek = 0;
    let previousWeek = 0;

    for (let i = 0; i < clampedDays; i++) {
      const stamp = stampForDaysAgo(i);
      const count = dayMap.get(stamp) ?? 0;
      totalCount += count;
      if (i < CURRENT_WEEK_DAYS) currentWeek += count;
      else previousWeek += count;
    }

    grandTotal += totalCount;
    grandCurrentWeek += currentWeek;
    grandPreviousWeek += previousWeek;

    // Build top messages
    const msgMap = msgCounts.get(def.name) ?? new Map<string, number>();
    const topMessages = Array.from(msgMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_MESSAGES_LIMIT)
      .map(([msg, count]) => ({ msg, count }));

    categoryStats.push({
      name: def.name,
      label: def.label,
      totalCount,
      sharePercent: 0, // filled after grandTotal is known
      currentWeek,
      previousWeek,
      deltaCount: currentWeek - previousWeek,
      deltaPercent: computeDeltaPercent(currentWeek, previousWeek),
      topMessages,
    });
  }

  // Compute % share now that grandTotal is known
  for (const cat of categoryStats) {
    cat.sharePercent =
      grandTotal === 0 ? 0 : Math.round((cat.totalCount / grandTotal) * 1000) / 10;
  }

  // Sort by totalCount desc
  categoryStats.sort((a, b) => b.totalCount - a.totalCount);

  // Build daily trend (newest first, then UI reverses for display)
  const dailyTrend: DailyTrendEntry[] = [];
  for (let i = clampedDays - 1; i >= 0; i--) {
    const stamp = stampForDaysAgo(i);
    const counts: Record<string, number> = {};
    for (const def of ERROR_CATEGORIES) {
      counts[def.name] = dayCounts.get(def.name)?.get(stamp) ?? 0;
    }
    dailyTrend.push({ date: stamp, counts });
  }

  return {
    categories: categoryStats,
    total: {
      count: grandTotal,
      currentWeek: grandCurrentWeek,
      previousWeek: grandPreviousWeek,
      deltaCount: grandCurrentWeek - grandPreviousWeek,
      deltaPercent: computeDeltaPercent(grandCurrentWeek, grandPreviousWeek),
    },
    dailyTrend,
    availableDays,
    unclassified,
  };
}
