/**
 * Task Knowledge Auto-Extraction Service
 *
 * On task completion, extracts lessons learned from verify.md, comments, and
 * execution logs, registers them as KnowledgeEntry records, and presents
 * related knowledge when similar tasks are created.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { sendAIMessage } from '../../utils/ai-client';
import { createContentHash } from './utils';
import { appendEvent } from './timeline';
import { memoryTaskQueue } from './index';

const log = createLogger('memory:task-knowledge');

/**
 * Auto-extract and register knowledge on task completion.
 *
 * @param taskId - Completed task ID
 * @returns Array of created KnowledgeEntry IDs
 */
export async function extractKnowledgeFromTask(taskId: number): Promise<number[]> {
  const entryIds: number[] = [];

  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        theme: { include: { category: true } },
        comments: { orderBy: { createdAt: 'desc' }, take: 10 },
        taskLabels: { include: { label: true } },
      },
    });

    if (!task) {
      log.warn({ taskId }, 'Task not found for knowledge extraction');
      return entryIds;
    }

    // Load verify.md content
    const verifyContent = await loadVerifyContent(taskId, task.theme?.categoryId, task.themeId);

    // Build extraction context
    const context = buildExtractionContext(task, verifyContent);

    if (context.length < 50) {
      log.debug({ taskId }, 'Insufficient context for knowledge extraction');
      return entryIds;
    }

    // Extract knowledge via AI
    const extracted = await extractWithAI(context, task.title);

    for (const item of extracted) {
      // Duplicate check by content hash
      const existing = await prisma.knowledgeEntry.findFirst({
        where: {
          contentHash: createContentHash(item.content),
          forgettingStage: { not: 'archived' },
        },
      });

      if (existing) {
        log.debug({ taskId, title: item.title }, 'Duplicate knowledge entry, skipping');
        continue;
      }

      const entry = await prisma.knowledgeEntry.create({
        data: {
          sourceType: 'task_pattern',
          sourceId: `task_${taskId}`,
          title: item.title,
          content: item.content,
          contentHash: createContentHash(item.content),
          category: item.category,
          tags: JSON.stringify(['auto_extracted', ...task.taskLabels.map((tl) => tl.label.name)]),
          confidence: 0.7,
          themeId: task.themeId,
          taskId: task.id,
          validationStatus: 'pending',
        },
      });

      entryIds.push(entry.id);

      // Queue background embedding generation
      await memoryTaskQueue.enqueue('embed', { entryId: entry.id, content: item.content }, 10);
      await memoryTaskQueue.enqueue('validate', { entryId: entry.id }, 5);
      await memoryTaskQueue.enqueue('detect_contradiction', { entryId: entry.id }, 3);
    }

    if (entryIds.length > 0) {
      await appendEvent({
        eventType: 'task_knowledge_extracted',
        actorType: 'system',
        payload: { taskId, entriesCreated: entryIds.length, entryIds },
      });

      // Create notification
      await prisma.notification.create({
        data: {
          type: 'knowledge_extracted',
          title: 'ナレッジ自動抽出完了',
          message: `タスク「${task.title}」から${entryIds.length}件のナレッジを抽出しました`,
          link: `/knowledge`,
          metadata: JSON.stringify({ taskId, entryIds }),
        },
      });

      log.info({ taskId, count: entryIds.length }, 'Knowledge extracted from task');
    }
  } catch (error) {
    log.error({ err: error, taskId }, 'Failed to extract knowledge from task');
  }

  return entryIds;
}

/**
 * Search and return related knowledge when creating/editing a task.
 */
export async function findRelatedKnowledge(
  title: string,
  description?: string | null,
  themeId?: number | null,
  limit: number = 5,
): Promise<
  Array<{
    id: number;
    title: string;
    content: string;
    category: string;
    confidence: number;
    relevanceScore: number;
  }>
> {
  try {
    // Keyword-based search (fallback when vector search is unavailable)
    const searchText = `${title} ${description || ''}`.toLowerCase();
    const keywords = searchText
      .split(/[\s\-_\/\\:;,.\(\)\[\]{}]+/)
      .filter((w) => w.length >= 2)
      .slice(0, 8);

    if (keywords.length === 0) return [];

    // Search active knowledge with theme matching.
    // NOTE: `mode: 'insensitive'` is PostgreSQL-only; SQLite Prisma clients
    // reject it as an unknown argument. We already lower-case the keywords
    // above (L140), and Japanese (the dominant content language) has no
    // case distinction, so dropping `mode` is functionally equivalent and
    // works on both database backends.
    const where: Record<string, unknown> = {
      forgettingStage: { in: ['active', 'dormant'] },
      OR: keywords.map((kw) => ({
        OR: [{ title: { contains: kw } }, { content: { contains: kw } }],
      })),
    };

    const entries = await prisma.knowledgeEntry.findMany({
      where,
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        confidence: true,
        decayScore: true,
        themeId: true,
        tags: true,
      },
      orderBy: [{ decayScore: 'desc' }, { confidence: 'desc' }],
      take: limit * 3, // Fetch extra for post-scoring
    });

    // Relevance scoring
    const scored = entries.map((entry) => {
      let relevanceScore = 0;

      // Keyword match count
      const entryText = `${entry.title} ${entry.content}`.toLowerCase();
      const matchCount = keywords.filter((kw) => entryText.includes(kw)).length;
      relevanceScore += (matchCount / keywords.length) * 50;

      // Theme match bonus
      if (themeId && entry.themeId === themeId) {
        relevanceScore += 30;
      }

      // Confidence and decay score
      relevanceScore += entry.confidence * 10;
      relevanceScore += entry.decayScore * 10;

      return {
        id: entry.id,
        title: entry.title,
        content: entry.content.slice(0, 500),
        category: entry.category,
        confidence: entry.confidence,
        relevanceScore: Math.round(relevanceScore * 100) / 100,
        /** True when this knowledge came from a different project/theme. */
        isCrossProject: themeId ? entry.themeId !== themeId : false,
        sourceThemeId: entry.themeId,
      };
    });

    return scored.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, limit);
  } catch (error) {
    log.error({ err: error }, 'Failed to find related knowledge');
    return [];
  }
}

/**
 * Search knowledge across ALL projects, explicitly surfacing cross-project insights.
 * Groups results by source theme to show "where this knowledge came from."
 *
 * @param query - Search query text / 検索クエリ
 * @param excludeThemeId - Current theme to de-prioritize (still included but flagged) / 除外するテーマ
 * @param limit - Max results / 最大結果数
 * @returns Knowledge grouped by source project / ソースプロジェクト別にグループ化された知識
 */
export async function searchCrossProjectKnowledge(
  query: string,
  excludeThemeId?: number | null,
  limit: number = 10,
): Promise<{
  results: Array<{
    id: number;
    title: string;
    content: string;
    category: string;
    confidence: number;
    relevanceScore: number;
    isCrossProject: boolean;
    sourceThemeId: number | null;
    sourceThemeName?: string;
  }>;
  totalAcrossProjects: number;
  projectCount: number;
}> {
  try {
    const keywords = query
      .toLowerCase()
      .split(/[\s\-_\/\\:;,.\(\)\[\]{}]+/)
      .filter((w) => w.length >= 2)
      .slice(0, 10);

    if (keywords.length === 0) return { results: [], totalAcrossProjects: 0, projectCount: 0 };

    const entries = await prisma.knowledgeEntry.findMany({
      where: {
        forgettingStage: { in: ['active', 'dormant'] },
        OR: keywords.map((kw) => ({
          OR: [
            { title: { contains: kw, mode: 'insensitive' as const } },
            { content: { contains: kw, mode: 'insensitive' as const } },
          ],
        })),
      },
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        confidence: true,
        decayScore: true,
        themeId: true,
        tags: true,
      },
      orderBy: [{ decayScore: 'desc' }, { confidence: 'desc' }],
      take: limit * 5,
    });

    // Fetch theme names for context
    const themeIds = [...new Set(entries.map((e) => e.themeId).filter(Boolean))] as number[];
    const themes =
      themeIds.length > 0
        ? await prisma.theme.findMany({
            where: { id: { in: themeIds } },
            select: { id: true, name: true },
          })
        : [];
    const themeMap = new Map(themes.map((t) => [t.id, t.name]));

    const scored = entries.map((entry) => {
      let relevanceScore = 0;
      const entryText = `${entry.title} ${entry.content}`.toLowerCase();
      const matchCount = keywords.filter((kw) => entryText.includes(kw)).length;
      relevanceScore += (matchCount / keywords.length) * 50;

      // NOTE: Cross-project knowledge gets a BONUS (not penalty) to surface diverse insights
      const isCrossProject = excludeThemeId ? entry.themeId !== excludeThemeId : false;
      if (isCrossProject && entry.themeId) {
        relevanceScore += 15;
      }

      relevanceScore += entry.confidence * 10;
      relevanceScore += entry.decayScore * 10;

      return {
        id: entry.id,
        title: entry.title,
        content: entry.content.slice(0, 500),
        category: entry.category,
        confidence: entry.confidence,
        relevanceScore: Math.round(relevanceScore * 100) / 100,
        isCrossProject,
        sourceThemeId: entry.themeId,
        sourceThemeName: entry.themeId ? themeMap.get(entry.themeId) : undefined,
      };
    });

    const sorted = scored.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, limit);
    const uniqueThemes = new Set(entries.map((e) => e.themeId).filter(Boolean));

    return {
      results: sorted,
      totalAcrossProjects: entries.length,
      projectCount: uniqueThemes.size,
    };
  } catch (error) {
    log.error({ err: error }, 'Failed to search cross-project knowledge');
    return { results: [], totalAcrossProjects: 0, projectCount: 0 };
  }
}

// ──── Helper Functions ────

async function loadVerifyContent(
  taskId: number,
  categoryId: number | null | undefined,
  themeId: number | null,
): Promise<string> {
  try {
    const { join } = await import('path');
    const { readFile } = await import('fs/promises');
    const dir = join(
      process.cwd(),
      'tasks',
      String(categoryId ?? 0),
      String(themeId ?? 0),
      String(taskId),
    );
    return await readFile(join(dir, 'verify.md'), 'utf-8');
  } catch {
    return '';
  }
}

function buildExtractionContext(
  task: {
    title: string;
    description: string | null;
    comments: Array<{ content: string }>;
  },
  verifyContent: string,
): string {
  const parts: string[] = [];

  parts.push(`タスク: ${task.title}`);
  if (task.description) {
    parts.push(`説明: ${task.description.slice(0, 500)}`);
  }
  if (verifyContent) {
    parts.push(`検証レポート:\n${verifyContent.slice(0, 2000)}`);
  }
  if (task.comments.length > 0) {
    const commentText = task.comments
      .slice(0, 5)
      .map((c) => c.content)
      .join('\n');
    parts.push(`コメント:\n${commentText.slice(0, 500)}`);
  }

  return parts.join('\n\n');
}

interface ExtractedKnowledge {
  title: string;
  content: string;
  category: string;
}

async function extractWithAI(context: string, _taskTitle: string): Promise<ExtractedKnowledge[]> {
  try {
    const response = await sendAIMessage({
      messages: [
        {
          role: 'user',
          content: `以下のタスク完了情報から、今後再利用できる知識を抽出してください。
各知識は独立した項目として、JSON配列で返してください。

${context}

以下のJSON形式で返してください（マークダウンのコードブロックなし、純粋なJSON配列のみ）:
[
  {
    "title": "知識のタイトル（簡潔に）",
    "content": "具体的な知識の内容（手順、注意点、パターンなど）",
    "category": "procedure|pattern|insight|fact"
  }
]

ルール:
- 汎用的で再利用可能な知識のみ抽出（タスク固有の情報は除外）
- 最大3件まで
- 空配列[]を返す場合は、抽出すべき知識がないことを意味する`,
        },
      ],
      maxTokens: 1024,
    });

    const text = response.content.trim();
    // Extract JSON portion
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as ExtractedKnowledge[];
    const validCategories = ['procedure', 'pattern', 'insight', 'fact', 'preference', 'general'];

    return parsed
      .filter((item) => item.title && item.content)
      .map((item) => ({
        title: item.title.slice(0, 200),
        content: item.content.slice(0, 2000),
        category: validCategories.includes(item.category) ? item.category : 'insight',
      }))
      .slice(0, 3);
  } catch (error) {
    log.error({ err: error }, 'AI extraction failed, returning empty');
    return [];
  }
}
