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

/**
 * Minimum combined confidence (actionability*0.6 + specificity*0.4) for
 * ideas to be included in auto-generation context. Enriched ideas with
 * low actionability or specificity fall below this threshold.
 */
const MIN_CONFIDENCE_FOR_CONTEXT = 0.4;

/** Ideas older than this are excluded from auto-generation context. */
const MAX_IDEA_AGE_DAYS = 90;

/**
 * Resolve themeIds belonging to a category.
 * KnowledgeEntry has themeId (Int) but no theme relation, so we query Theme first.
 */
async function getThemeIdsForCategory(categoryId: number): Promise<number[]> {
  const themes = await prisma.theme.findMany({
    where: { categoryId },
    select: { id: true },
  });
  return themes.map((t) => t.id);
}

export type IdeaScope = 'global' | 'project';

export interface IdeaBoxEntry {
  id: number;
  title: string;
  content: string;
  category: string;
  scope: IdeaScope;
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
  /** "global" for cross-project ideas, "project" for project-specific */
  scope?: IdeaScope;
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

  const scope = input.scope ?? (input.themeId ? 'project' : 'global');
  const allTags = [...(input.tags ?? []), `scope:${scope}`];

  const entry = await prisma.knowledgeEntry.create({
    data: {
      sourceType: 'idea_box',
      sourceId: input.source ?? 'user',
      title: input.title,
      content: input.content,
      contentHash: hash,
      category: input.category ?? 'improvement',
      tags: JSON.stringify(allTags),
      confidence: input.confidence ?? 0.7,
      themeId: input.themeId ?? null,
      taskId: input.taskId ?? null,
      forgettingStage: 'active',
      decayScore: 1.0,
      validationStatus: 'pending',
    },
  });

  log.info({ id: entry.id, title: input.title }, 'Idea submitted');

  // Pipeline: enrich (Ollama) → review (Haiku) asynchronously
  import('./idea-extractor')
    .then(({ enrichIdea }) =>
      enrichIdea(entry.id, input.title, input.content).then(() =>
        import('./idea-extractor').then(({ reviewIdea }) => reviewIdea(entry.id)),
      ),
    )
    .catch(() => {});

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
  themeId?: number;
  unusedOnly?: boolean;
  scope?: IdeaScope;
  limit?: number;
  offset?: number;
}): Promise<{ ideas: IdeaBoxEntry[]; total: number }> {
  const { categoryId, themeId, unusedOnly = false, scope, limit = 20, offset = 0 } = options;

  const where = await buildWhereClause(categoryId, themeId, unusedOnly, scope);

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
  const themeFilter = categoryId
    ? { themeId: { in: await getThemeIdsForCategory(categoryId) } }
    : {};
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - MAX_IDEA_AGE_DAYS);

  const where = {
    sourceType: 'idea_box' as const,
    forgettingStage: 'active',
    confidence: { gte: MIN_CONFIDENCE_FOR_CONTEXT },
    createdAt: { gte: cutoffDate },
    NOT: { sourceId: { startsWith: 'used_task_' } },
    ...themeFilter,
  };

  const entries = await prisma.knowledgeEntry.findMany({
    where,
    orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });

  return entries.map(toIdeaBoxEntry);
}

export interface UpdateIdeaInput {
  title?: string;
  content?: string;
  category?: string;
  scope?: IdeaScope;
  /** Pass null to clear the existing themeId; undefined to leave unchanged. */
  themeId?: number | null;
  tags?: string[];
}

/**
 * Update an existing idea. Recomputes contentHash so dedup stays consistent.
 *
 * @param ideaId - KnowledgeEntry ID / アイデアID
 * @param input - Fields to update / 更新フィールド
 * @returns true on success, false if the idea was not found / 成否
 * @throws Error when title/content would become empty / タイトル・内容が空になる場合
 */
export async function updateIdea(ideaId: number, input: UpdateIdeaInput): Promise<boolean> {
  const existing = await prisma.knowledgeEntry.findUnique({
    where: { id: ideaId },
    select: {
      id: true,
      sourceType: true,
      title: true,
      content: true,
      category: true,
      tags: true,
      themeId: true,
    },
  });

  if (!existing || existing.sourceType !== 'idea_box') return false;

  const nextTitle = input.title?.trim() ?? existing.title;
  const nextContent = input.content?.trim() ?? existing.content;
  if (!nextTitle || !nextContent) {
    throw new Error('タイトルと内容は必須です');
  }

  // Determine themeId: undefined keeps current, explicit null clears.
  let nextThemeId: number | null;
  if (input.themeId === undefined) nextThemeId = existing.themeId;
  else nextThemeId = input.themeId;

  // Reconcile scope tag with the new themeId. Explicit scope wins, otherwise
  // derive from themeId presence.
  const existingTags = JSON.parse(existing.tags || '[]') as string[];
  const userTags = (input.tags ?? existingTags).filter((t) => !t.startsWith('scope:'));
  const nextScope: IdeaScope =
    input.scope ?? (nextThemeId !== null && nextThemeId !== undefined ? 'project' : 'global');
  const nextTags = [...userTags, `scope:${nextScope}`];

  const nextHash = createContentHash(`${nextTitle}:${nextContent}`);

  await prisma.knowledgeEntry.update({
    where: { id: ideaId },
    data: {
      title: nextTitle,
      content: nextContent,
      contentHash: nextHash,
      category: input.category ?? existing.category,
      tags: JSON.stringify(nextTags),
      themeId: nextThemeId ?? null,
    },
  });

  log.info({ ideaId }, 'Idea updated');
  return true;
}

/**
 * Delete an idea from the IdeaBox. Validates existence and sourceType before deletion.
 *
 * @param ideaId - KnowledgeEntry ID / アイデアID
 * @returns true on successful deletion, false if idea not found / 削除成否
 */
export async function deleteIdea(ideaId: number): Promise<boolean> {
  const existing = await prisma.knowledgeEntry.findUnique({
    where: { id: ideaId },
    select: { id: true, sourceType: true },
  });

  if (!existing || existing.sourceType !== 'idea_box') {
    log.debug({ ideaId }, 'Idea not found or not an idea_box entry');
    return false;
  }

  try {
    await prisma.knowledgeEntry.delete({ where: { id: ideaId } });
    log.info({ ideaId }, 'Idea deleted successfully');
    return true;
  } catch (err) {
    log.error({ err, ideaId }, 'Failed to delete idea');
    return false;
  }
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
  const themeFilter = categoryId
    ? { themeId: { in: await getThemeIdsForCategory(categoryId) } }
    : {};
  const baseWhere = {
    sourceType: 'idea_box' as const,
    forgettingStage: 'active',
    ...themeFilter,
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
async function buildWhereClause(
  categoryId?: number,
  themeId?: number,
  unusedOnly?: boolean,
  scope?: IdeaScope,
) {
  // themeIdが直接指定されている場合はそれを優先、そうでなければcategoryIdからthemeIdsを取得
  let themeFilter = {};
  if (themeId) {
    themeFilter = { themeId };
  } else if (categoryId) {
    themeFilter = { themeId: { in: await getThemeIdsForCategory(categoryId) } };
  }

  return {
    sourceType: 'idea_box' as const,
    forgettingStage: 'active',
    ...(unusedOnly ? { NOT: { sourceId: { startsWith: 'used_task_' } } } : {}),
    ...(scope ? { tags: { contains: `scope:${scope}` } } : {}),
    ...themeFilter,
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
  const parsedTags = JSON.parse(entry.tags || '[]') as string[];
  const scopeTag = parsedTags.find((t) => t.startsWith('scope:'));
  const scope: IdeaScope = scopeTag === 'scope:project' ? 'project' : 'global';
  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    category: entry.category,
    scope,
    tags: parsedTags.filter((t) => !t.startsWith('scope:')),
    confidence: entry.confidence,
    themeId: entry.themeId,
    taskId: entry.taskId,
    source: usedMatch ? 'used' : (entry.sourceId ?? 'user'),
    usedInTaskId: usedMatch ? parseInt(usedMatch[1]) : null,
    createdAt: entry.createdAt,
  };
}
