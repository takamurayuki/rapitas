/**
 * Daily Briefing Service
 *
 * AI-powered morning briefing that analyzes the user's tasks, deadlines,
 * dependencies, work patterns, and IdeaBox to suggest an optimal daily plan.
 * Uses cost-optimized routing: Ollama for data gathering, Haiku for generation.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { sendAIMessage } from '../../utils/ai-client';
import { getLocalLLMStatus } from '../local-llm';
import { getUnusedIdeasForContext, type IdeaBoxEntry } from '../memory/idea-box-service';

const log = createLogger('ai:daily-briefing');

export interface DailyBriefing {
  date: string;
  greeting: string;
  summary: string;
  priorityTasks: Array<{
    id: number;
    title: string;
    reason: string;
    estimatedMinutes: number;
  }>;
  warnings: string[];
  insights: string[];
  ideaSuggestion: string | null;
  estimatedProductiveHours: number;
}

interface BriefingContext {
  overdueTasks: Array<{ id: number; title: string; dueDate: Date; priority: string }>;
  dueTodayTasks: Array<{
    id: number;
    title: string;
    priority: string;
    estimatedHours: number | null;
  }>;
  inProgressTasks: Array<{
    id: number;
    title: string;
    priority: string;
    estimatedHours: number | null;
  }>;
  blockedTasks: Array<{ id: number; title: string; blockerTitle: string }>;
  recentCompletionRate: number;
  avgDailyCompletions: number;
  ideas: IdeaBoxEntry[];
  dayOfWeek: string;
}

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * Gather all context needed for the daily briefing.
 *
 * @param categoryId - Optional category scope / カテゴリスコープ
 * @returns Structured briefing context / ブリーフィングコンテキスト
 */
async function gatherBriefingContext(categoryId?: number | null): Promise<BriefingContext> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86400000);
  const weekAgo = new Date(now.getTime() - 7 * 86400000);

  const categoryFilter = categoryId ? { theme: { categoryId } } : {};

  const [overdue, dueToday, inProgress, blocked, completedThisWeek] = await Promise.all([
    prisma.task.findMany({
      where: {
        dueDate: { lt: todayStart },
        status: { notIn: ['done', 'completed'] },
        parentId: null,
        ...categoryFilter,
      },
      select: { id: true, title: true, dueDate: true, priority: true },
      orderBy: { dueDate: 'asc' },
      take: 10,
    }),
    prisma.task.findMany({
      where: {
        dueDate: { gte: todayStart, lt: todayEnd },
        status: { notIn: ['done', 'completed'] },
        parentId: null,
        ...categoryFilter,
      },
      select: { id: true, title: true, priority: true, estimatedHours: true },
      take: 10,
    }),
    prisma.task.findMany({
      where: {
        status: 'in_progress',
        parentId: null,
        ...categoryFilter,
      },
      select: { id: true, title: true, priority: true, estimatedHours: true },
      take: 10,
    }),
    prisma.task.findMany({
      where: {
        status: { notIn: ['done', 'completed'] },
        parentId: null,
        incomingDependencies: {
          some: { fromTask: { status: { notIn: ['done', 'completed'] } } },
        },
        ...categoryFilter,
      },
      select: {
        id: true,
        title: true,
        incomingDependencies: {
          select: { fromTask: { select: { title: true } } },
          take: 1,
        },
      },
      take: 5,
    }),
    prisma.task.count({
      where: {
        status: { in: ['done', 'completed'] },
        completedAt: { gte: weekAgo },
        parentId: null,
        ...categoryFilter,
      },
    }),
  ]);

  const ideas = await getUnusedIdeasForContext(categoryId ?? null, 3);

  return {
    overdueTasks: overdue.map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.dueDate!,
      priority: t.priority,
    })),
    dueTodayTasks: dueToday.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      estimatedHours: t.estimatedHours,
    })),
    inProgressTasks: inProgress.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      estimatedHours: t.estimatedHours,
    })),
    blockedTasks: blocked.map((t) => ({
      id: t.id,
      title: t.title,
      blockerTitle: t.incomingDependencies[0]?.fromTask.title ?? '不明',
    })),
    recentCompletionRate: completedThisWeek,
    avgDailyCompletions: Math.round((completedThisWeek / 7) * 10) / 10,
    ideas,
    dayOfWeek: DAY_NAMES[now.getDay()],
  };
}

/**
 * Build the LLM prompt for daily briefing generation.
 */
function buildBriefingPrompt(ctx: BriefingContext): string {
  const overdueLines =
    ctx.overdueTasks.length > 0
      ? ctx.overdueTasks
          .map(
            (t) =>
              `- ⚠️ [${t.priority}] ${t.title} (期限: ${t.dueDate.toLocaleDateString('ja-JP')})`,
          )
          .join('\n')
      : '(なし)';

  const todayLines =
    ctx.dueTodayTasks.length > 0
      ? ctx.dueTodayTasks
          .map(
            (t) =>
              `- [${t.priority}] ${t.title}${t.estimatedHours ? ` (${t.estimatedHours}h)` : ''}`,
          )
          .join('\n')
      : '(なし)';

  const progressLines =
    ctx.inProgressTasks.length > 0
      ? ctx.inProgressTasks
          .map((t) => `- ${t.title}${t.estimatedHours ? ` (${t.estimatedHours}h)` : ''}`)
          .join('\n')
      : '(なし)';

  const blockedLines =
    ctx.blockedTasks.length > 0
      ? ctx.blockedTasks.map((t) => `- ${t.title} ← ブロック元: ${t.blockerTitle}`).join('\n')
      : '(なし)';

  const ideaLines =
    ctx.ideas.length > 0
      ? ctx.ideas.map((i) => `- [${i.category}] ${i.title}`).join('\n')
      : '(なし)';

  return `あなたはプロダクティビティAIアシスタントです。
今日（${ctx.dayOfWeek}曜日）のデイリーブリーフィングを作成してください。

## 期限超過タスク
${overdueLines}

## 今日が期限のタスク
${todayLines}

## 進行中のタスク
${progressLines}

## ブロックされているタスク
${blockedLines}

## 今週の実績
- 完了タスク: ${ctx.recentCompletionRate}件（1日平均: ${ctx.avgDailyCompletions}件）

## IdeaBoxの未使用アイデア
${ideaLines}

以下のJSON形式で返してください（他のテキスト不要）:
{
  "greeting": "短い挨拶（曜日を反映）",
  "summary": "今日の状況を1-2文で要約",
  "priorityTasks": [
    {"id": タスクID, "title": "タスク名", "reason": "なぜ今日やるべきか", "estimatedMinutes": 推定分数}
  ],
  "warnings": ["注意すべき事項"],
  "insights": ["生産性に関する洞察"],
  "ideaSuggestion": "IdeaBoxからの提案（あれば）",
  "estimatedProductiveHours": 推定稼働時間
}`;
}

/**
 * Generate a daily briefing using AI.
 *
 * @param categoryId - Optional category scope / カテゴリスコープ
 * @returns Generated daily briefing / 生成されたデイリーブリーフィング
 */
export async function generateDailyBriefing(categoryId?: number | null): Promise<DailyBriefing> {
  const ctx = await gatherBriefingContext(categoryId);

  log.info(
    {
      overdue: ctx.overdueTasks.length,
      today: ctx.dueTodayTasks.length,
      inProgress: ctx.inProgressTasks.length,
    },
    'Generating daily briefing',
  );

  const prompt = buildBriefingPrompt(ctx);

  const localStatus = await getLocalLLMStatus().catch(() => ({ available: false }));
  const useLocal = (localStatus as { available: boolean }).available;

  const response = await sendAIMessage({
    provider: useLocal ? 'ollama' : 'claude',
    model: useLocal ? 'llama3.2' : 'claude-haiku-4-5-20251001',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1000,
  });

  const jsonMatch = response.content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse briefing response');
  }

  const parsed = JSON.parse(jsonMatch[0]) as Omit<DailyBriefing, 'date'>;

  return {
    date: new Date().toISOString().split('T')[0],
    ...parsed,
  };
}
