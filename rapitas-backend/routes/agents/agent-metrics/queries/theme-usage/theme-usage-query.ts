/**
 * Theme Usage Query
 *
 * Daily × theme aggregation of tokens / executions / duration / cost from
 * already-recorded AgentExecution rows. Pure DB aggregation — no LLM calls.
 * Cost is summed only from executions with a real (> 0) cost and reported with
 * costKnownCount so the UI never shows an unrecorded cost as ¥0.
 */

import { prisma } from '../../../../../config/database';
import { toNumber, toInt } from '../../metric-coercion';
import { getUsdJpyRate } from '../../currency-config';
import {
  localDateKey,
  localDayStart,
  resolveExecutionTokens,
} from '../../../../../services/usage-budget/usage-budget-math';
import type {
  ClassificationRule,
  ExecutionUsageSample,
} from '../../../../../services/usage-budget/usage-budget-types';
import { resolveSessionThemes } from './theme-usage-resolver';

/** Aggregated usage of one (day, theme) or (theme) cell. */
export interface UsageCell {
  tokens: number;
  executions: number;
  durationMs: number;
  /** Sum over executions with costUsd > 0 only. */
  costUsd: number;
  /** Executions whose costUsd was actually recorded (> 0). */
  costKnownCount: number;
  /** Denominator for costKnownCount (same as executions). */
  executionCount: number;
}

export interface ThemeUsageTotal extends UsageCell {
  themeId: number;
  themeName: string | null;
}

export interface ThemeUsageDay {
  date: string;
  /** Keyed by String(themeId); 0 = 未分類. */
  byTheme: Record<string, UsageCell>;
  total: UsageCell;
}

export interface ThemeUsageResult {
  days: number;
  tzOffsetMinutes: number;
  usdJpyRate: number;
  unresolvedCount: number;
  themes: ThemeUsageTotal[];
  daily: ThemeUsageDay[];
}

interface ExecutionRow {
  sessionId: number;
  startedAt: Date | null;
  createdAt: Date;
  tokensUsed: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  executionTimeMs: number | null;
  costUsd: unknown;
}

function emptyCell(): UsageCell {
  return {
    tokens: 0,
    executions: 0,
    durationMs: 0,
    costUsd: 0,
    costKnownCount: 0,
    executionCount: 0,
  };
}

function addSample(cell: UsageCell, s: ExecutionUsageSample): void {
  cell.tokens += s.tokens;
  cell.executions += 1;
  cell.executionCount += 1;
  cell.durationMs += s.durationMs;
  if (s.costUsd > 0) {
    cell.costUsd = Math.round((cell.costUsd + s.costUsd) * 1_000_000) / 1_000_000;
    cell.costKnownCount += 1;
  }
}

/**
 * Load executions created since `since` and resolve each one's theme.
 *
 * @param since - Inclusive lower bound on createdAt / 取得開始時刻
 * @param rules - Classification rules / 分類ルール
 * @param now - Upper bound (exclusive of later rows) / 現在時刻
 * @returns Samples plus the number of executions whose join chain broke / サンプルと結合切れ件数
 */
export async function loadUsageSamples(
  since: Date,
  rules: ClassificationRule[],
  now: Date = new Date(),
): Promise<{ samples: ExecutionUsageSample[]; unresolvedCount: number }> {
  const rows = (await prisma.agentExecution.findMany({
    where: { createdAt: { gte: since, lte: now } },
    select: {
      sessionId: true,
      startedAt: true,
      createdAt: true,
      tokensUsed: true,
      inputTokens: true,
      outputTokens: true,
      executionTimeMs: true,
      costUsd: true,
    },
  })) as ExecutionRow[];

  const themes = await resolveSessionThemes(
    rows.map((r) => r.sessionId),
    rules,
  );
  let unresolvedCount = 0;
  const samples = rows.map((r): ExecutionUsageSample => {
    const theme = themes.get(r.sessionId);
    if (!theme || !theme.resolved) unresolvedCount += 1;
    return {
      at: r.startedAt ?? r.createdAt,
      tokens: resolveExecutionTokens({
        tokensUsed: toInt(r.tokensUsed),
        inputTokens: toInt(r.inputTokens),
        outputTokens: toInt(r.outputTokens),
      }),
      durationMs: toInt(r.executionTimeMs),
      costUsd: toNumber(r.costUsd),
      themeId: theme?.themeId ?? 0,
    };
  });
  return { samples, unresolvedCount };
}

/**
 * Display names for theme ids (0 / deleted themes are absent).
 *
 * @param themeIds - Theme ids / テーマID
 * @returns Map themeId → name / テーマ名
 */
export async function loadThemeNames(themeIds: number[]): Promise<Map<number, string>> {
  const ids = Array.from(new Set(themeIds.filter((id) => id > 0)));
  if (ids.length === 0) return new Map();
  const rows = await prisma.theme.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Pure daily × theme aggregation over pre-seeded local-day buckets.
 *
 * @param samples - Execution samples / 実行サンプル
 * @param opts - days / tzOffsetMinutes / now / themeNames / 集計条件
 * @returns Per-theme totals (largest token use first) and per-day cells / 集計結果
 */
export function aggregateThemeDaily(
  samples: ExecutionUsageSample[],
  opts: { days: number; tzOffsetMinutes: number; now: Date; themeNames: Map<number, string> },
): Pick<ThemeUsageResult, 'themes' | 'daily'> {
  const dailyMap = new Map<string, ThemeUsageDay>();
  for (let i = opts.days - 1; i >= 0; i--) {
    const key = localDateKey(
      localDayStart(opts.now, opts.tzOffsetMinutes, i),
      opts.tzOffsetMinutes,
    );
    dailyMap.set(key, { date: key, byTheme: {}, total: emptyCell() });
  }
  const themeMap = new Map<number, UsageCell>();

  for (const s of samples) {
    const day = dailyMap.get(localDateKey(s.at, opts.tzOffsetMinutes));
    if (!day) continue;
    const key = String(s.themeId);
    const cell = day.byTheme[key] ?? emptyCell();
    addSample(cell, s);
    day.byTheme[key] = cell;
    addSample(day.total, s);
    const themeCell = themeMap.get(s.themeId) ?? emptyCell();
    addSample(themeCell, s);
    themeMap.set(s.themeId, themeCell);
  }

  const themes = Array.from(themeMap.entries())
    .map(([themeId, cell]) => ({
      themeId,
      themeName: opts.themeNames.get(themeId) ?? null,
      ...cell,
    }))
    .sort((a, b) => b.tokens - a.tokens || a.themeId - b.themeId);
  return { themes, daily: Array.from(dailyMap.values()) };
}

/**
 * Daily × theme usage for the trailing `days` local days.
 *
 * @param p - days / tzOffsetMinutes / rules / now / 集計条件
 * @returns Aggregation result / 集計結果
 */
export async function getThemeUsage(p: {
  days: number;
  tzOffsetMinutes: number;
  rules: ClassificationRule[];
  now?: Date;
}): Promise<ThemeUsageResult> {
  const now = p.now ?? new Date();
  const since = localDayStart(now, p.tzOffsetMinutes, p.days - 1);
  const { samples, unresolvedCount } = await loadUsageSamples(since, p.rules, now);
  const themeNames = await loadThemeNames(samples.map((s) => s.themeId));
  const { themes, daily } = aggregateThemeDaily(samples, {
    days: p.days,
    tzOffsetMinutes: p.tzOffsetMinutes,
    now,
    themeNames,
  });
  return {
    days: p.days,
    tzOffsetMinutes: p.tzOffsetMinutes,
    usdJpyRate: getUsdJpyRate(),
    unresolvedCount,
    themes,
    daily,
  };
}
