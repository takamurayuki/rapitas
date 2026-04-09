/**
 * weekly-review-service
 *
 * Aggregates a week's worth of user activity (completed tasks, TimeEntry,
 * PomodoroSession, top themes, daily distribution) and asks Claude Haiku
 * for a short Japanese narrative review. Persists the result in the
 * `WeeklyReview` table so it can be displayed in the /reports page and
 * does not get regenerated on subsequent runs.
 *
 * Tier S #3 — see docs/adr/ if a future change deserves an ADR.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { getApiKeyForProvider } from '../../utils/ai-client';

type PrismaInstance = InstanceType<typeof PrismaClient>;

const log = createLogger('ai:weekly-review');

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 600;
const TEMPERATURE = 0.5;

/** Aggregated stats fed into the Claude prompt. */
export interface WeeklyAggregate {
  weekStart: Date;
  weekEnd: Date;
  completedTasks: Array<{
    title: string;
    themeName: string | null;
    completedAt: Date;
    actualHours: number | null;
    estimatedHours: number | null;
  }>;
  totalCompletedCount: number;
  totalFocusMinutes: number;
  totalTimeEntryMinutes: number;
  pomodoroSessions: number;
  topThemes: Array<{ name: string; count: number }>;
  dailyDistribution: Record<string, number>;
}

/**
 * Compute the Monday-00:00 of the ISO week containing `date`, in the
 * server's local timezone. The MVP intentionally trusts OS TZ; per-user
 * timezone support is deferred to v2 (UserSettings.timezone).
 */
export function getWeekStart(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // getDay() returns 0=Sun .. 6=Sat. We want Monday as start.
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/** Compute the Sunday-23:59:59.999 that closes the week starting at `weekStart`. */
export function getWeekEnd(weekStart: Date): Date {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** Aggregate one week of user activity for the prompt. */
export async function aggregateWeeklyData(
  prisma: PrismaInstance,
  weekStart: Date,
): Promise<WeeklyAggregate> {
  const weekEnd = getWeekEnd(weekStart);

  const [completedTasks, pomodoroSessions, timeEntries] = await Promise.all([
    prisma.task.findMany({
      where: {
        status: { in: ['done', 'completed'] },
        completedAt: { gte: weekStart, lte: weekEnd },
      },
      select: {
        title: true,
        completedAt: true,
        actualHours: true,
        estimatedHours: true,
        theme: { select: { name: true } },
      },
      orderBy: { completedAt: 'asc' },
    }),
    prisma.pomodoroSession.findMany({
      where: {
        type: 'work',
        status: 'completed',
        completedAt: { gte: weekStart, lte: weekEnd },
      },
      select: { duration: true, elapsed: true },
    }),
    prisma.timeEntry.findMany({
      where: {
        startedAt: { gte: weekStart, lte: weekEnd },
      },
      select: { duration: true },
    }),
  ]);

  const totalFocusSeconds = pomodoroSessions.reduce(
    (sum, s) => sum + (s.elapsed || s.duration || 0),
    0,
  );
  // TimeEntry.duration is stored in hours (Float). Convert to minutes.
  const totalTimeEntryMinutes = Math.round(
    timeEntries.reduce((sum, e) => sum + (e.duration || 0) * 60, 0),
  );

  // Theme distribution (top 5)
  const themeCounts = new Map<string, number>();
  for (const t of completedTasks) {
    const name = t.theme?.name ?? '(なし)';
    themeCounts.set(name, (themeCounts.get(name) ?? 0) + 1);
  }
  const topThemes = [...themeCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Daily distribution YYYY-MM-DD → count
  const dailyDistribution: Record<string, number> = {};
  for (const t of completedTasks) {
    if (!t.completedAt) continue;
    const key = t.completedAt.toISOString().slice(0, 10);
    dailyDistribution[key] = (dailyDistribution[key] ?? 0) + 1;
  }

  return {
    weekStart,
    weekEnd,
    completedTasks: completedTasks.map((t) => ({
      title: t.title,
      themeName: t.theme?.name ?? null,
      completedAt: t.completedAt as Date,
      actualHours: t.actualHours,
      estimatedHours: t.estimatedHours,
    })),
    totalCompletedCount: completedTasks.length,
    totalFocusMinutes: Math.round(totalFocusSeconds / 60),
    totalTimeEntryMinutes,
    pomodoroSessions: pomodoroSessions.length,
    topThemes,
    dailyDistribution,
  };
}

/**
 * Build the Claude prompt from the aggregated stats. Pure function — easy
 * to unit-test without spinning up the API client.
 */
export function buildPrompt(aggregate: WeeklyAggregate): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const taskLines = aggregate.completedTasks.slice(0, 30).map((t) => {
    const theme = t.themeName ? ` [${t.themeName}]` : '';
    const hours = t.actualHours ? ` (${t.actualHours.toFixed(1)}h)` : '';
    return `- ${t.title}${theme}${hours}`;
  });
  if (aggregate.completedTasks.length > 30) {
    taskLines.push(`- ... 他 ${aggregate.completedTasks.length - 30} 件`);
  }

  const themeLines = aggregate.topThemes.map((t) => `- ${t.name}: ${t.count}件`);

  const dailyLines = Object.entries(aggregate.dailyDistribution)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => `- ${date}: ${count}件`);

  return `あなたはユーザーの週次レビューを書くアシスタントです。
以下の集約データを基に、自然な日本語で 200-400 字程度の振り返りを書いてください。

## 期間
${fmt(aggregate.weekStart)} 〜 ${fmt(aggregate.weekEnd)}

## 完了タスク (${aggregate.totalCompletedCount}件)
${taskLines.join('\n') || '- (なし)'}

## 集中時間
- ポモドーロ完了セッション: ${aggregate.pomodoroSessions}回 / 集中時間 ${aggregate.totalFocusMinutes}分
- TimeEntry 合計: ${aggregate.totalTimeEntryMinutes}分

## テーマ別タスク数
${themeLines.join('\n') || '- (なし)'}

## 日別完了タスク数
${dailyLines.join('\n') || '- (なし)'}

レビューには以下を含めてください:
1. 達成のハイライト (1-2 文)
2. 数値的な振り返り (1 文)
3. 改善できる点 / 来週への提案 (1-2 文)

Markdown は使わず、プレーンテキストの 1 段落で書いてください。`;
}

/** Look up the Anthropic API key (DB or env), or return null if unset. */
async function resolveApiKey(): Promise<string | null> {
  const dbKey = await getApiKeyForProvider('claude').catch(() => null);
  if (dbKey) return dbKey;
  return process.env.ANTHROPIC_API_KEY ?? null;
}

/**
 * Call Claude with the prepared prompt and return the raw text reply.
 * Throws if the API key is missing or the API rejects the request.
 */
export async function callClaudeForReview(
  prompt: string,
  model: string = DEFAULT_MODEL,
): Promise<string> {
  const apiKey = await resolveApiKey();
  if (!apiKey) {
    throw new Error('Anthropic API key is not configured');
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    messages: [{ role: 'user', content: prompt }],
  });

  // Concatenate all text blocks (Claude can return multiple). The SDK's
  // ContentBlock is a discriminated union, so a custom type predicate
  // doesn't satisfy structural assignability — narrow inline instead.
  const text = response.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');

  if (!text.trim()) {
    throw new Error('Claude returned an empty response');
  }
  return text.trim();
}

/**
 * High-level orchestrator. Idempotent: if a review already exists for the
 * given week, returns it without re-calling Claude.
 *
 * @param prisma - Prisma client (defaults to the shared singleton)
 * @param weekStart - Monday of the target week. Defaults to last week.
 */
export async function generateWeeklyReview(
  prisma: PrismaInstance = defaultPrisma,
  weekStart?: Date,
) {
  // Default: review LAST week (current Monday minus 7 days), since this is
  // typically run on Monday morning to summarize the just-finished week.
  const targetWeekStart = weekStart ?? (() => {
    const lastWeek = getWeekStart();
    lastWeek.setDate(lastWeek.getDate() - 7);
    return lastWeek;
  })();

  const existing = await prisma.weeklyReview.findUnique({
    where: { weekStart: targetWeekStart },
  });
  if (existing) {
    log.debug({ weekStart: targetWeekStart }, 'Weekly review already exists, returning cached');
    return existing;
  }

  const aggregate = await aggregateWeeklyData(prisma, targetWeekStart);

  // Empty week — short-circuit without calling Claude.
  if (aggregate.totalCompletedCount === 0 && aggregate.pomodoroSessions === 0) {
    log.info({ weekStart: targetWeekStart }, 'Empty week, generating fallback review');
    return prisma.weeklyReview.create({
      data: {
        weekStart: targetWeekStart,
        weekEnd: aggregate.weekEnd,
        summary: '先週は記録された活動がありませんでした。今週は小さなタスクから始めてみましょう。',
        stats: JSON.stringify(aggregate),
        modelUsed: 'fallback',
      },
    });
  }

  const prompt = buildPrompt(aggregate);
  const summary = await callClaudeForReview(prompt);

  log.info(
    { weekStart: targetWeekStart, taskCount: aggregate.totalCompletedCount },
    'Weekly review generated',
  );

  return prisma.weeklyReview.create({
    data: {
      weekStart: targetWeekStart,
      weekEnd: aggregate.weekEnd,
      summary,
      stats: JSON.stringify(aggregate),
      modelUsed: DEFAULT_MODEL,
    },
  });
}

/** Return the most recent weekly review (or null if none exist). */
export async function getLatestWeeklyReview(prisma: PrismaInstance = defaultPrisma) {
  return prisma.weeklyReview.findFirst({
    orderBy: { weekStart: 'desc' },
  });
}

/** Return the N most recent weekly reviews (default 10). */
export async function getWeeklyReviews(
  prisma: PrismaInstance = defaultPrisma,
  limit: number = 10,
) {
  return prisma.weeklyReview.findMany({
    orderBy: { weekStart: 'desc' },
    take: Math.min(Math.max(1, limit), 52),
  });
}

/** Delete a single weekly review by id. */
export async function deleteWeeklyReview(
  prisma: PrismaInstance = defaultPrisma,
  id: number,
): Promise<void> {
  await prisma.weeklyReview.delete({ where: { id } });
}
