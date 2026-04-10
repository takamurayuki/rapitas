/**
 * auto-task-generator
 *
 * Analyzes the project state (recently completed tasks, open issues, codebase)
 * to generate new tasks that should be worked on next. Used by the
 * "auto-execution mode" feature on the task list page.
 *
 * Flow: analyze context → Claude prompt → parse suggestions → create tasks →
 * optionally trigger agent execution.
 */
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { getApiKeyForProvider } from '../../utils/ai-client';

const log = createLogger('ai:auto-task-generator');

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 2000;

export interface GeneratedTask {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  themeId?: number;
  estimatedHours?: number;
  reasoning: string;
}

export interface AutoGenerateResult {
  generatedTasks: Array<GeneratedTask & { taskId: number }>;
  executionTriggered: boolean;
  prompt: string;
}

/**
 * Gather context for the Claude prompt: recent completed tasks, open tasks,
 * available themes, and recent activity patterns.
 */
async function gatherContext() {
  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [recentCompleted, openTasks, themes, recentActivity] = await Promise.all([
    prisma.task.findMany({
      where: {
        status: { in: ['done', 'completed'] },
        completedAt: { gte: twoWeeksAgo },
        parentId: null,
      },
      select: { title: true, description: true, status: true, completedAt: true, theme: { select: { name: true } } },
      orderBy: { completedAt: 'desc' },
      take: 20,
    }),
    prisma.task.findMany({
      where: {
        status: { in: ['todo', 'in_progress'] },
        parentId: null,
      },
      select: { title: true, status: true, priority: true, theme: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
    prisma.theme.findMany({
      select: { id: true, name: true, isDevelopment: true },
      where: { isDevelopment: true },
    }),
    prisma.activityLog.findMany({
      where: { createdAt: { gte: twoWeeksAgo } },
      select: { action: true, metadata: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
  ]);

  return { recentCompleted, openTasks, themes, recentActivity };
}

/**
 * Build the Claude prompt from gathered context.
 */
function buildPrompt(context: Awaited<ReturnType<typeof gatherContext>>): string {
  const completedLines = context.recentCompleted
    .map((t) => `- ${t.title}${t.theme?.name ? ` [${t.theme.name}]` : ''}`)
    .join('\n') || '(なし)';

  const openLines = context.openTasks
    .map((t) => `- [${t.status}/${t.priority}] ${t.title}${t.theme?.name ? ` [${t.theme.name}]` : ''}`)
    .join('\n') || '(なし)';

  const themeLines = context.themes
    .map((t) => `- ID:${t.id} "${t.name}"`)
    .join('\n') || '(なし)';

  return `あなたはプロジェクトマネージャーAIです。以下のプロジェクトの状況を分析して、
次に取り組むべきタスクを3〜5件提案してください。

## 最近完了したタスク (直近2週間)
${completedLines}

## 現在オープンなタスク
${openLines}

## 開発テーマ一覧
${themeLines}

## 提案ルール
1. 既存のオープンタスクと重複しないこと
2. 最近完了したタスクの流れを汲む改善・フォローアップを優先
3. 各タスクにタイトル、説明、優先度、推定時間、提案理由を含める
4. 可能であれば開発テーマID (themeId) を指定する
5. 実行可能で具体的なタスクにする（「〇〇を検討する」ではなく「〇〇を実装する」）

以下のJSON配列形式で返してください（他のテキストは不要）:
[
  {
    "title": "タスクタイトル",
    "description": "具体的な説明",
    "priority": "medium",
    "themeId": null,
    "estimatedHours": 2,
    "reasoning": "なぜこのタスクが必要か"
  }
]`;
}

/**
 * Call Claude to generate task suggestions, then create them in the DB.
 *
 * @param autoExecute - If true, mark created tasks as autoExecutable
 * @returns Created tasks and whether execution was triggered
 */
export async function autoGenerateTasks(
  autoExecute: boolean = false,
): Promise<AutoGenerateResult> {
  const apiKey = await getApiKeyForProvider('claude').catch(() => null)
    ?? process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('Anthropic API key is not configured');
  }

  const context = await gatherContext();
  const prompt = buildPrompt(context);

  log.info('Generating auto-tasks via Claude...');

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: 0.7,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');

  // Parse JSON array from Claude's response
  let suggestions: GeneratedTask[];
  try {
    // Extract JSON array from response (Claude may wrap it in markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in response');
    }
    suggestions = JSON.parse(jsonMatch[0]);
  } catch (e) {
    log.error({ response: text }, 'Failed to parse Claude response as JSON');
    throw new Error(`Failed to parse task suggestions: ${e instanceof Error ? e.message : 'Unknown'}`);
  }

  // Validate and filter
  suggestions = suggestions
    .filter((s) => s.title && s.description)
    .slice(0, 5);

  if (suggestions.length === 0) {
    return { generatedTasks: [], executionTriggered: false, prompt };
  }

  // Create tasks in DB
  const createdTasks: Array<GeneratedTask & { taskId: number }> = [];
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

    createdTasks.push({
      ...suggestion,
      taskId: task.id,
    });

    log.info(
      { taskId: task.id, title: suggestion.title },
      'Auto-generated task created',
    );
  }

  log.info(`Auto-generated ${createdTasks.length} tasks (autoExecute: ${autoExecute})`);

  return {
    generatedTasks: createdTasks,
    executionTriggered: autoExecute,
    prompt,
  };
}
