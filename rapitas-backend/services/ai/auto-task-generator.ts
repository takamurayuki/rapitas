/**
 * auto-task-generator
 *
 * Analyzes project state (completed tasks, open issues, IdeaBox ideas) to
 * generate balanced new tasks. Supports category-scoped generation and
 * learning data threshold checks.
 *
 * Flow: validate threshold → gather context + ideas → build prompt →
 * LLM call → parse suggestions → create tasks → mark ideas as used.
 */
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { getApiKeyForProvider } from '../../utils/ai-client';
import {
  getUnusedIdeasForContext,
  markIdeaAsUsed,
  type IdeaBoxEntry,
} from '../memory/idea-box-service';

const log = createLogger('ai:auto-task-generator');

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 2000;

/** Minimum completed tasks required for reliable auto-generation. */
const MIN_COMPLETED_TASKS = 10;

export interface GeneratedTask {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  themeId?: number;
  estimatedHours?: number;
  reasoning: string;
  /** IDs of IdeaBox entries that inspired this task. */
  ideaIds?: number[];
}

export interface AutoGenerateOptions {
  autoExecute?: boolean;
  categoryId?: number | null;
  /** Skip the minimum threshold check. */
  force?: boolean;
}

export interface AutoGenerateResult {
  generatedTasks: Array<GeneratedTask & { taskId: number }>;
  executionTriggered: boolean;
  prompt: string;
  ideasUsed: number;
  /** True when completed task count is below the threshold. */
  insufficientData?: boolean;
  completedTaskCount?: number;
}

/**
 * Gather context scoped by category for the LLM prompt.
 *
 * @param categoryId - Optional category filter / カテゴリフィルタ
 */
async function gatherContext(categoryId?: number | null) {
  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const categoryFilter = categoryId ? { theme: { categoryId } } : {};

  const [recentCompleted, openTasks, themes, ideas] = await Promise.all([
    prisma.task.findMany({
      where: {
        status: { in: ['done', 'completed'] },
        completedAt: { gte: twoWeeksAgo },
        parentId: null,
        ...categoryFilter,
      },
      select: {
        title: true,
        description: true,
        status: true,
        completedAt: true,
        theme: { select: { name: true } },
      },
      orderBy: { completedAt: 'desc' },
      take: 20,
    }),
    prisma.task.findMany({
      where: {
        status: { in: ['todo', 'in_progress'] },
        parentId: null,
        ...categoryFilter,
      },
      select: { title: true, status: true, priority: true, theme: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
    prisma.theme.findMany({
      select: { id: true, name: true, isDevelopment: true },
      where: {
        isDevelopment: true,
        ...(categoryId ? { categoryId } : {}),
      },
    }),
    getUnusedIdeasForContext(categoryId ?? null, 10),
  ]);

  return { recentCompleted, openTasks, themes, ideas };
}

/**
 * Count completed tasks for threshold validation.
 *
 * @param categoryId - Optional category scope / カテゴリスコープ
 * @returns Number of completed tasks / 完了タスク数
 */
async function countCompletedTasks(categoryId?: number | null): Promise<number> {
  return prisma.task.count({
    where: {
      status: { in: ['done', 'completed'] },
      parentId: null,
      ...(categoryId ? { theme: { categoryId } } : {}),
    },
  });
}

/**
 * Build the LLM prompt from gathered context and ideas.
 */
function buildPrompt(
  context: Awaited<ReturnType<typeof gatherContext>>,
): string {
  const completedLines =
    context.recentCompleted
      .map((t) => `- ${t.title}${t.theme?.name ? ` [${t.theme.name}]` : ''}`)
      .join('\n') || '(なし)';

  const openLines =
    context.openTasks
      .map(
        (t) =>
          `- [${t.status}/${t.priority}] ${t.title}${t.theme?.name ? ` [${t.theme.name}]` : ''}`,
      )
      .join('\n') || '(なし)';

  const themeLines = context.themes.map((t) => `- ID:${t.id} "${t.name}"`).join('\n') || '(なし)';

  const ideaLines =
    context.ideas.length > 0
      ? context.ideas
          .map((i) => `- [${i.category}] ${i.title}: ${i.content.slice(0, 100)}`)
          .join('\n')
      : '(なし)';

  return `あなたはプロジェクトマネージャーAIです。以下のプロジェクトの状況を分析して、
次に取り組むべきタスクを3〜5件提案してください。

## 最近完了したタスク (直近2週間)
${completedLines}

## 現在オープンなタスク
${openLines}

## 開発テーマ一覧
${themeLines}

## IdeaBox（AI・ユーザーからの改善アイデア）
${ideaLines}

## タスク生成のバランス指針
- 約30%: 最近のトレンドに基づく改善・フォローアップ
- 約40%: IdeaBoxのアイデアに基づくタスク（未使用のアイデアを優先的に活用）
- 約30%: ギャップ分析に基づくタスク（不足領域の特定と補完）

## 提案ルール
1. 既存のオープンタスクと重複しないこと
2. 各タスクにタイトル、説明、優先度、推定時間、提案理由を含める
3. 可能であれば開発テーマID (themeId) を指定する
4. 実行可能で具体的なタスクにする（「〇〇を検討する」ではなく「〇〇を実装する」）
5. IdeaBoxのアイデアを活用した場合、reasoningにどのアイデアを参照したか記載する

以下のJSON配列形式で返してください（他のテキストは不要）:
[
  {
    "title": "タスクタイトル",
    "description": "具体的な説明",
    "priority": "medium",
    "themeId": null,
    "estimatedHours": 2,
    "reasoning": "なぜこのタスクが必要か（参照アイデア: ...）"
  }
]`;
}

/**
 * Generate tasks with IdeaBox integration and category scoping.
 *
 * @param options - Generation options / 生成オプション
 * @returns Generated tasks, usage stats, and threshold status / 生成結果
 */
export async function autoGenerateTasks(
  options: AutoGenerateOptions = {},
): Promise<AutoGenerateResult> {
  const { autoExecute = false, categoryId, force = false } = options;

  // Threshold check
  const completedCount = await countCompletedTasks(categoryId);
  if (!force && completedCount < MIN_COMPLETED_TASKS) {
    log.info({ completedCount, categoryId }, 'Insufficient data for auto-generation');
    return {
      generatedTasks: [],
      executionTriggered: false,
      prompt: '',
      ideasUsed: 0,
      insufficientData: true,
      completedTaskCount: completedCount,
    };
  }

  const apiKey =
    (await getApiKeyForProvider('claude').catch(() => null)) ?? process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('Anthropic API key is not configured');
  }

  const context = await gatherContext(categoryId);
  const prompt = buildPrompt(context);

  log.info({ categoryId, ideaCount: context.ideas.length }, 'Generating auto-tasks via Claude...');

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: 0.7,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.map((block) => (block.type === 'text' ? block.text : '')).join('');

  let suggestions: GeneratedTask[];
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in response');
    }
    suggestions = JSON.parse(jsonMatch[0]);
  } catch (e) {
    log.error({ response: text }, 'Failed to parse Claude response as JSON');
    throw new Error(
      `Failed to parse task suggestions: ${e instanceof Error ? e.message : 'Unknown'}`,
    );
  }

  suggestions = suggestions.filter((s) => s.title && s.description).slice(0, 5);

  if (suggestions.length === 0) {
    return {
      generatedTasks: [],
      executionTriggered: false,
      prompt,
      ideasUsed: 0,
      completedTaskCount: completedCount,
    };
  }

  // Create tasks and mark used ideas
  const createdTasks: Array<GeneratedTask & { taskId: number }> = [];
  let ideasUsed = 0;

  for (const suggestion of suggestions) {
    const task = await prisma.task.create({
      data: {
        title: suggestion.title,
        description: suggestion.description,
        priority: suggestion.priority || 'medium',
        estimatedHours: suggestion.estimatedHours ?? null,
        themeId: suggestion.themeId ?? null,
        status: 'todo',
        autoExecutable: autoExecute,
        agentGenerated: true,
        isDeveloperMode: true,
      },
    });

    createdTasks.push({ ...suggestion, taskId: task.id });
    log.info({ taskId: task.id, title: suggestion.title }, 'Auto-generated task created');
  }

  // Mark ideas as used based on reasoning references
  ideasUsed = await markUsedIdeas(context.ideas, createdTasks);

  log.info(
    { count: createdTasks.length, ideasUsed, autoExecute },
    'Auto-generation complete',
  );

  return {
    generatedTasks: createdTasks,
    executionTriggered: autoExecute,
    prompt,
    ideasUsed,
    completedTaskCount: completedCount,
  };
}

/**
 * Mark IdeaBox ideas as used based on generated task references.
 * Matches ideas whose title appears in any task's reasoning field.
 */
async function markUsedIdeas(
  ideas: IdeaBoxEntry[],
  tasks: Array<GeneratedTask & { taskId: number }>,
): Promise<number> {
  let count = 0;
  for (const idea of ideas) {
    const referenced = tasks.some(
      (t) => t.reasoning?.includes(idea.title) || t.description?.includes(idea.title),
    );
    if (referenced) {
      await markIdeaAsUsed(idea.id, tasks[0].taskId);
      count++;
    }
  }
  return count;
}
