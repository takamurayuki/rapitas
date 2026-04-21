/**
 * IdeaBox Service
 *
 * Manages improvement ideas collected from agent execution, copilot chat,
 * and manual user input. Ideas are stored as KnowledgeEntry records with
 * sourceType='idea_box'. Used by the auto-task generator for balanced task creation.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { createContentHash } from './utils';

const log = createLogger('memory:idea-box');

/** Minimum confidence threshold for ideas to be included in auto-generation context. */
const MIN_CONFIDENCE_FOR_CONTEXT = 0.3;

export interface IdeaBoxEntry {
  id: number;
  title: string;
  content: string;
  category: string;
  tags: string[];
  confidence: number;
  themeId: number | null;
  taskId: number | null;
  source: string;
  usedInTaskId: number | null;
  createdAt: Date;
}

export interface SubmitIdeaInput {
  title: string;
  content: string;
  category?: string;
  themeId?: number;
  taskId?: number;
  tags?: string[];
  /** Origin of the idea: "user" | "agent_execution" | "copilot" | "code_review" */
  source?: string;
  confidence?: number;
}

/**
 * Submit a new idea to the IdeaBox. Deduplicates by content hash.
 *
 * @param input - Idea details / アイデアの詳細
 * @returns Created KnowledgeEntry ID, or existing ID if duplicate / 作成されたID
 */
export async function submitIdea(input: SubmitIdeaInput): Promise<number> {
  const hash = createContentHash(`${input.title}:${input.content}`);

  // Deduplicate
  const existing = await prisma.knowledgeEntry.findFirst({
    where: { contentHash: hash, sourceType: 'idea_box' },
    select: { id: true },
  });

  if (existing) {
    log.debug({ id: existing.id }, 'Duplicate idea skipped');
    return existing.id;
  }

  const entry = await prisma.knowledgeEntry.create({
    data: {
      sourceType: 'idea_box',
      sourceId: input.source ?? 'user',
      title: input.title,
      content: input.content,
      contentHash: hash,
      category: input.category ?? 'improvement',
      tags: JSON.stringify(input.tags ?? []),
      confidence: input.confidence ?? 0.7,
      themeId: input.themeId ?? null,
      taskId: input.taskId ?? null,
      forgettingStage: 'active',
      decayScore: 1.0,
      validationStatus: 'pending',
    },
  });

  log.info({ id: entry.id, title: input.title }, 'Idea submitted');
  return entry.id;
}

/**
 * List ideas with optional filtering by category, theme, and usage state.
 *
 * @param options - Filter and pagination options / フィルタ・ページネーション
 * @returns Ideas and total count / アイデアリストと総数
 */
export async function listIdeas(options: {
  categoryId?: number;
  unusedOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ ideas: IdeaBoxEntry[]; total: number }> {
  const { categoryId, unusedOnly = false, limit = 20, offset = 0 } = options;

  const where = buildWhereClause(categoryId, unusedOnly);

  const [entries, total] = await Promise.all([
    prisma.knowledgeEntry.findMany({
      where,
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      skip: offset,
    }),
    prisma.knowledgeEntry.count({ where }),
  ]);

  const ideas = entries.map(toIdeaBoxEntry);
  return { ideas, total };
}

/**
 * Get unused ideas for auto-task generation context, scoped by category.
 *
 * @param categoryId - Filter by category (via theme relation) / カテゴリフィルタ
 * @param limit - Max ideas to return / 最大件数
 * @returns High-confidence unused ideas / 未使用の高信頼度アイデア
 */
export async function getUnusedIdeasForContext(
  categoryId: number | null,
  limit = 10,
): Promise<IdeaBoxEntry[]> {
  const where = {
    sourceType: 'idea_box' as const,
    forgettingStage: 'active',
    confidence: { gte: MIN_CONFIDENCE_FOR_CONTEXT },
    NOT: { sourceId: { startsWith: 'used_task_' } },
    ...(categoryId ? { theme: { categoryId } } : {}),
  };

  const entries = await prisma.knowledgeEntry.findMany({
    where,
    orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });

  return entries.map(toIdeaBoxEntry);
}

/**
 * Mark an idea as used in a generated task.
 *
 * @param ideaId - KnowledgeEntry ID / アイデアID
 * @param taskId - Task that used this idea / 使用先タスクID
 */
export async function markIdeaAsUsed(ideaId: number, taskId: number): Promise<void> {
  await prisma.knowledgeEntry.update({
    where: { id: ideaId },
    data: { sourceId: `used_task_${taskId}` },
  });
  log.debug({ ideaId, taskId }, 'Idea marked as used');
}

/**
 * Get idea statistics, optionally scoped by category.
 *
 * @param categoryId - Optional category filter / カテゴリフィルタ
 * @returns Counts by category and usage state / カテゴリ別・使用状態別の統計
 */
export async function getIdeaStats(categoryId?: number): Promise<{
  total: number;
  unused: number;
  byCategory: Array<{ category: string; count: number }>;
}> {
  const baseWhere = {
    sourceType: 'idea_box' as const,
    forgettingStage: 'active',
    ...(categoryId ? { theme: { categoryId } } : {}),
  };

  const [total, unused, grouped] = await Promise.all([
    prisma.knowledgeEntry.count({ where: baseWhere }),
    prisma.knowledgeEntry.count({
      where: { ...baseWhere, NOT: { sourceId: { startsWith: 'used_task_' } } },
    }),
    prisma.knowledgeEntry.groupBy({
      by: ['category'],
      where: baseWhere,
      _count: { id: true },
    }),
  ]);

  return {
    total,
    unused,
    byCategory: grouped.map((g) => ({ category: g.category, count: g._count.id })),
  };
}

/** Build Prisma where clause for idea queries. */
function buildWhereClause(categoryId?: number, unusedOnly?: boolean) {
  return {
    sourceType: 'idea_box' as const,
    forgettingStage: 'active',
    ...(unusedOnly ? { NOT: { sourceId: { startsWith: 'used_task_' } } } : {}),
    ...(categoryId ? { theme: { categoryId } } : {}),
  };
}

/** Map a KnowledgeEntry DB record to the IdeaBoxEntry interface. */
function toIdeaBoxEntry(entry: {
  id: number;
  title: string;
  content: string;
  category: string;
  tags: string;
  confidence: number;
  themeId: number | null;
  taskId: number | null;
  sourceId: string | null;
  createdAt: Date;
}): IdeaBoxEntry {
  const usedMatch = entry.sourceId?.match(/^used_task_(\d+)$/);
  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    category: entry.category,
    tags: JSON.parse(entry.tags || '[]') as string[],
    confidence: entry.confidence,
    themeId: entry.themeId,
    taskId: entry.taskId,
    source: usedMatch ? 'used' : (entry.sourceId ?? 'user'),
    usedInTaskId: usedMatch ? parseInt(usedMatch[1]) : null,
    createdAt: entry.createdAt,
  };
}
