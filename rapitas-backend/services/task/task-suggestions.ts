/**
 * Task Suggestions
 *
 * AI-generated task suggestions for a theme.
 * Frequency-based suggestions live in task-frequency-suggestions.ts.
 * Prompt constants and builders live in task-ai-prompts.ts.
 * Does NOT handle task mutations or duplicate cleanup.
 */
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../../config/logger';
import {
  sendAIMessage,
  getDefaultProvider,
  isAnyApiKeyConfigured,
  type AIMessage,
} from '../../utils/ai-client';
import {
  AI_SUGGESTION_SYSTEM_PROMPT,
  buildTaskSummary,
  buildPatternSummary,
  buildPreferenceSummary,
} from './task-ai-prompts';

// Re-export for backward compatibility via task-suggestions namespace
export { getFrequencyBasedSuggestions } from './task-frequency-suggestions';

type PrismaInstance = InstanceType<typeof PrismaClient>;

const logger = createLogger('task-suggestions');

// ============ AI suggestions ============

/** Shape of a single AI-generated suggestion item. */
interface AISuggestionItem {
  title: string;
  description: string | null;
  priority: string;
  estimatedHours: number | null;
  reason: string | null;
  category: string;
  completionCriteria: string | null;
  measurableOutcome: string | null;
  dependencies: string | null;
  suggestedApproach: string | null;
  labelIds: number[];
  frequency: number;
}

/**
 * Parses the raw AI response JSON into typed suggestion items.
 *
 * @param content - Raw AI response string / AI応答の生文字列
 * @param limit - Maximum number of suggestions / 最大提案件数
 * @returns Parsed suggestions and analysis text / パース済みの提案と分析テキスト
 */
function parseSuggestionResponse(
  content: string,
  limit: number,
): { suggestions: AISuggestionItem[]; analysis: string | null } {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { suggestions: [], analysis: null };
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const suggestions: AISuggestionItem[] = (parsed.suggestions || [])
    .slice(0, limit)
    .map((s: Record<string, unknown>) => ({
      title: s.title as string,
      description: (s.description as string) || null,
      priority: (s.priority as string) || 'medium',
      estimatedHours: (s.estimatedHours as number) || null,
      reason: (s.reason as string) || null,
      category: (s.category as string) || 'new',
      completionCriteria: (s.completionCriteria as string) || null,
      measurableOutcome: (s.measurableOutcome as string) || null,
      dependencies: (s.dependencies as string) || null,
      suggestedApproach: (s.suggestedApproach as string) || null,
      labelIds: [],
      frequency: 0,
    }));

  return { suggestions, analysis: parsed.analysis || null };
}

/**
 * Generates AI-powered task suggestions for a theme, using completed task history and behavior.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param themeId - Theme to generate suggestions for / 提案生成対象のテーマ
 * @param limit - Maximum number of suggestions / 最大提案件数
 * @returns Suggestion result with source indicator / ソース情報付きの提案結果
 */
export async function generateAISuggestions(
  prisma: PrismaInstance,
  themeId: number,
  limit: number,
): Promise<{
  suggestions: AISuggestionItem[];
  analysis?: string | null;
  source: string;
  tokensUsed?: number;
}> {
  const aiAvailable = await isAnyApiKeyConfigured();
  if (!aiAvailable) {
    return { suggestions: [], source: 'insufficient_data' };
  }

  const theme = await prisma.theme.findUnique({
    where: { id: themeId },
    select: { id: true, name: true, description: true },
  });

  if (!theme) {
    return { suggestions: [], source: 'none' };
  }

  // Collect data in parallel
  const [completedTasks, taskPatterns, behaviorSummary, existingTasks] = await Promise.all([
    prisma.task.findMany({
      where: { themeId, parentId: null, status: 'done' },
      select: {
        title: true,
        description: true,
        priority: true,
        estimatedHours: true,
        actualHours: true,
        completedAt: true,
        taskLabels: { include: { label: true } },
      },
      orderBy: { completedAt: 'desc' },
      take: 30,
    }),
    prisma.taskPattern.findMany({
      where: { themeId, frequency: { gte: 2 } },
      orderBy: [{ frequency: 'desc' }, { lastOccurrence: 'desc' }],
      take: 10,
    }),
    prisma.userBehaviorSummary.findFirst({
      where: { themeId, periodType: { in: ['weekly', 'monthly'] } },
      orderBy: { periodEnd: 'desc' },
    }),
    prisma.task.findMany({
      where: { themeId, parentId: null, status: { in: ['todo', 'in-progress'] } },
      select: { title: true },
    }),
  ]);

  const existingTitles = existingTasks.map((t: { title: string }) => t.title);
  const existingTaskList =
    existingTitles.length > 0
      ? `\n\n## 現在進行中・未着手のタスク（これらと重複しないこと）\n${existingTitles.map((t: string) => `- ${t}`).join('\n')}`
      : '';

  const taskSummary = buildTaskSummary(completedTasks);
  const patternSummaryText = buildPatternSummary(taskPatterns);
  const preferenceSummaryText = buildPreferenceSummary(behaviorSummary);

  const userPrompt =
    completedTasks.length > 0
      ? `## テーマ: ${theme.name}${theme.description ? ` (${theme.description})` : ''}\n\n## 過去の完了タスク（新しい順）\n${taskSummary}${patternSummaryText}${preferenceSummaryText}${existingTaskList}\n\n上記の過去タスクとユーザーの行動パターンを分析し、パーソナライズされた次に取り組むべきタスクを${limit}件提案してください。\n既存の進行中・未着手タスクと重複しない提案をお願いします。`
      : `## テーマ: ${theme.name}${theme.description ? ` (${theme.description})` : ''}\n\nこのテーマに関するタスクはまだありません。${existingTaskList}\n\nテーマの内容から推測して、最初に取り組むべきタスクを${limit}件提案してください。\n既存の進行中・未着手タスクと重複しない提案をお願いします。`;

  try {
    const provider = await getDefaultProvider();
    const messages: AIMessage[] = [{ role: 'user', content: userPrompt }];

    const response = await sendAIMessage({
      provider,
      messages,
      systemPrompt: AI_SUGGESTION_SYSTEM_PROMPT,
      maxTokens: 2048,
    });

    const { suggestions, analysis } = parseSuggestionResponse(response.content, limit);

    if (suggestions.length === 0) {
      logger.error('[task-suggestions] Failed to parse AI response');
      return { suggestions: [], source: 'ai_error' };
    }

    await cacheSuggestions(prisma, themeId, suggestions, analysis);

    return { suggestions, analysis, source: 'ai', tokensUsed: response.tokensUsed };
  } catch (error) {
    logger.error({ err: error }, '[task-suggestions] AI suggestion failed');
    return { suggestions: [], source: 'ai_error' };
  }
}

/**
 * Persists generated suggestions to the cache table, replacing prior entries for the theme.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param themeId - Theme the suggestions belong to / 提案が属するテーマ
 * @param suggestions - Suggestion items to cache / キャッシュする提案アイテム
 * @param analysis - Analysis text to attach to the first row / 最初の行に付与する分析テキスト
 */
async function cacheSuggestions(
  prisma: PrismaInstance,
  themeId: number,
  suggestions: AISuggestionItem[],
  analysis: string | null,
): Promise<void> {
  try {
    if (!prisma.taskSuggestionCache) return;

    await prisma.taskSuggestionCache.deleteMany({ where: { themeId } });

    if (suggestions.length > 0) {
      await prisma.taskSuggestionCache.createMany({
        data: suggestions.map((s, idx) => ({
          themeId,
          title: s.title,
          description: s.description,
          priority: s.priority,
          estimatedHours: s.estimatedHours,
          reason: s.reason,
          category: s.category,
          labelIds: JSON.stringify(s.labelIds),
          analysis: idx === 0 ? analysis : null,
          completionCriteria: s.completionCriteria,
          measurableOutcome: s.measurableOutcome,
          dependencies: s.dependencies,
          suggestedApproach: s.suggestedApproach,
        })),
      });
    }
  } catch (cacheError) {
    logger.error({ err: cacheError }, '[task-suggestions] Failed to cache suggestions');
  }
}
