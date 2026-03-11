/**
 * タスク完了時ナレッジ自動抽出サービス
 *
 * タスク完了時にverify.md/コメント/実行ログから学んだことを
 * KnowledgeEntryとして自動登録し、類似タスク作成時に関連ナレッジを提示する
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { sendAIMessage } from '../../utils/ai-client';
import { createContentHash } from './utils';
import { appendEvent } from './timeline';
import { memoryTaskQueue } from './index';

const log = createLogger('memory:task-knowledge');

/**
 * タスク完了時にナレッジを自動抽出して登録
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

    // verify.mdの内容を読み取り
    const verifyContent = await loadVerifyContent(taskId, task.theme?.categoryId, task.themeId);

    // 抽出に使うコンテキストを構築
    const context = buildExtractionContext(task, verifyContent);

    if (context.length < 50) {
      log.debug({ taskId }, 'Insufficient context for knowledge extraction');
      return entryIds;
    }

    // AIでナレッジ抽出
    const extracted = await extractWithAI(context, task.title);

    for (const item of extracted) {
      // 重複チェック（同じタイトルのエントリが既にあるか）
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

      // バックグラウンドでembedding生成
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

      // 通知作成
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
 * タスク作成/編集時に関連ナレッジを検索して返す
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
    // キーワードベース検索（ベクトル検索が利用不可の場合のフォールバック）
    const searchText = `${title} ${description || ''}`.toLowerCase();
    const keywords = searchText
      .split(/[\s\-_\/\\:;,.\(\)\[\]{}]+/)
      .filter((w) => w.length >= 2)
      .slice(0, 8);

    if (keywords.length === 0) return [];

    // テーマ一致 + アクティブなナレッジを検索
    const where: Record<string, unknown> = {
      forgettingStage: { in: ['active', 'dormant'] },
      OR: keywords.map((kw) => ({
        OR: [
          { title: { contains: kw, mode: 'insensitive' } },
          { content: { contains: kw, mode: 'insensitive' } },
        ],
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
      take: limit * 3, // 多めに取得してスコアリング
    });

    // 関連度スコアリング
    const scored = entries.map((entry) => {
      let relevanceScore = 0;

      // キーワードマッチ数
      const entryText = `${entry.title} ${entry.content}`.toLowerCase();
      const matchCount = keywords.filter((kw) => entryText.includes(kw)).length;
      relevanceScore += (matchCount / keywords.length) * 50;

      // テーマ一致ボーナス
      if (themeId && entry.themeId === themeId) {
        relevanceScore += 30;
      }

      // 信頼度と減衰スコア
      relevanceScore += entry.confidence * 10;
      relevanceScore += entry.decayScore * 10;

      return {
        id: entry.id,
        title: entry.title,
        content: entry.content.slice(0, 500),
        category: entry.category,
        confidence: entry.confidence,
        relevanceScore: Math.round(relevanceScore * 100) / 100,
      };
    });

    return scored.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, limit);
  } catch (error) {
    log.error({ err: error }, 'Failed to find related knowledge');
    return [];
  }
}

// ──── ヘルパー関数 ────

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
    // JSON部分を抽出
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
