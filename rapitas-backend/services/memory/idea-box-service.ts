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
import { sanitizeMarkdownContent } from '../../utils/common/mojibake-detector';
import { narrowEnum } from '../../utils/common/type-guards';
import { findSaturatedTheme } from './theme-saturation';

// Theme-saturation gate (anti-monoculture). Embedding cosine (all-MiniLM-L6-v2)
// proved USELESS for Japanese idea similarity (novel ideas scored HIGHER than
// near-dups), so theme-saturation.ts uses a LEXICAL signal: a new idea is rejected
// when its title shares a ≥SALIENT_LEN-char substring with ≥SATURATION_CAP existing
// idea_box entries (the theme is over-represented). Tunable via the env below.
const SALIENT_LEN = 4;
const SATURATION_CAP = (() => {
  const v = parseInt(process.env.RAPITAS_IDEA_SATURATION_CAP ?? '8', 10);
  return Number.isFinite(v) && v > 0 ? v : 8;
})();

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

/**
 * How much the idea would innovate or raise the app's value if built. Conveys
 * the idea's "temperature": high = transformative, low = nice-to-have.
 */
export const IDEA_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export type IdeaPriority = (typeof IDEA_PRIORITIES)[number];

/** Coerces an arbitrary value to a valid priority, defaulting to medium. */
export function normalizeIdeaPriority(value: unknown): IdeaPriority {
  return narrowEnum(value, IDEA_PRIORITIES, 'medium');
}

export interface IdeaBoxEntry {
  id: number;
  title: string;
  content: string;
  category: string;
  scope: IdeaScope;
  /** Innovation / value-uplift priority (idea "temperature"). */
  priority: IdeaPriority;
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
  /** Innovation / value-uplift priority (idea "temperature"). */
  priority?: IdeaPriority;
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
/**
 * Resolve the most appropriate theme for ideas filed against a task, so they
 * don't fall into the "global" bucket just because the task itself has no theme.
 * Order: the task's own theme → a theme whose working directory matches the
 * task's → the default theme. Returns null only when none can be found (then the
 * idea is genuinely global).
 *
 * @param taskId - Task the idea came from / アイデアの発生元タスクID
 * @returns The best theme id, or null. / 最適なテーマID、無ければnull
 */
export async function resolveTaskThemeId(taskId: number): Promise<number | null> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { themeId: true, workingDirectory: true },
    });
    if (task?.themeId != null) return task.themeId;
    if (task?.workingDirectory) {
      const byDir = await prisma.theme.findFirst({
        where: { workingDirectory: task.workingDirectory },
        select: { id: true },
      });
      if (byDir) return byDir.id;
    }
    // Fall back to a theme that actually has a working directory — ideas become
    // tasks that run in a repo, so a working-dir theme is the meaningful home (and
    // a null/empty workingDirectory would otherwise show as a generic project/
    // global icon). Prefer a default working-dir theme, then any. Treat empty
    // string as no working dir, matching the UI's truthy filter. Only when no
    // working-dir theme exists at all do we fall back to a default / null.
    return await resolveDefaultThemeId();
  } catch {
    return null;
  }
}

/**
 * Resolve the home theme to use when an idea has no task/theme of its own.
 * Prefers a default theme with a working directory, then any theme with one,
 * then the default theme, then ANY theme — so an idea is tied to a real theme
 * (and shows that theme's icon) instead of falling into the global/地球儀 bucket.
 * Returns null only when no theme exists at all.
 *
 * @returns A theme id to attribute the idea to, or null if there are no themes.
 */
export async function resolveDefaultThemeId(): Promise<number | null> {
  const candidates = await prisma.theme
    .findMany({
      select: { id: true, isDefault: true, workingDirectory: true },
      orderBy: { id: 'asc' },
    })
    .catch(() => [] as { id: number; isDefault: boolean; workingDirectory: string | null }[]);
  const hasWd = (wd: string | null): boolean => !!wd && wd.trim() !== '';
  const defaultWithWd = candidates.find((t) => t.isDefault && hasWd(t.workingDirectory));
  if (defaultWithWd) return defaultWithWd.id;
  const anyWithWd = candidates.find((t) => hasWd(t.workingDirectory));
  if (anyWithWd) return anyWithWd.id;
  // Last resort: the default theme, else ANY theme — never null while a theme exists.
  return candidates.find((t) => t.isDefault)?.id ?? candidates[0]?.id ?? null;
}

export async function submitIdea(input: SubmitIdeaInput): Promise<number> {
  // 文字化けチェック＆修正: agent submissions (via curl / files on Windows) can
  // arrive mojibake'd; repair title/content BEFORE storing so a garbled idea never
  // lands in the box. sanitizeMarkdownContent only adopts a fix that improves the
  // mojibake score, else keeps the original — so clean text is untouched.
  const sanTitle = sanitizeMarkdownContent(input.title);
  const sanContent = sanitizeMarkdownContent(input.content);
  const title = sanTitle.content;
  const content = sanContent.content;
  if (sanTitle.wasFixed || sanContent.wasFixed) {
    log.info(
      { issues: [...sanTitle.issues, ...sanContent.issues] },
      '[idea-box] Repaired mojibake before registering idea',
    );
  }
  const hash = createContentHash(`${title}:${content}`);

  // Exact-hash dedup (cheap).
  const existing = await prisma.knowledgeEntry.findFirst({
    where: { contentHash: hash, sourceType: 'idea_box' },
    select: { id: true },
  });

  if (existing) {
    log.debug({ id: existing.id }, 'Duplicate idea skipped');
    return existing.id;
  }

  // Theme-saturation gate (anti-monoculture): reject when the idea box already holds
  // SATURATION_CAP+ open ideas about the same theme (lexical, see findSaturatedTheme-
  // Anchor). Breaks the self-reinforcing loop — the agent works on theme X →
  // idea-extractor + innovation session keep re-filing "theme X" ideas → near-
  // duplicate tasks (observed: 96 ideas almost all type-guard/SSOT; PRs #270-275 six
  // near-synonymous type-guard refactors). Both funnel through here, so one gate
  // stops both. Returns the existing anchor id so callers treat it as a no-op dedup.
  const anchorId = await findSaturatedTheme(title, {
    sourceType: 'idea_box',
    cap: SATURATION_CAP,
    salient: SALIENT_LEN,
  });
  if (anchorId != null) {
    log.info(
      { anchorId, title: input.title },
      '[idea-box] Rejected idea: theme over-represented (anti-monoculture)',
    );
    return anchorId;
  }

  // Always attribute an idea to a real theme so it never falls into the global
  // (地球儀) bucket: use the caller's themeId, else the source task's theme, else
  // the default theme. With a single-project setup (only rapitas) every idea thus
  // lands on that theme. Only an explicit scope:'global' keeps it themeless.
  let themeId = input.themeId ?? null;
  if (themeId == null && input.scope !== 'global') {
    if (input.taskId != null) themeId = await resolveTaskThemeId(input.taskId);
    if (themeId == null) themeId = await resolveDefaultThemeId();
  }

  const scope = input.scope ?? (themeId ? 'project' : 'global');
  const priority = normalizeIdeaPriority(input.priority);
  const allTags = [...(input.tags ?? []), `scope:${scope}`, `priority:${priority}`];

  const entry = await prisma.knowledgeEntry.create({
    data: {
      sourceType: 'idea_box',
      sourceId: input.source ?? 'user',
      title,
      content,
      contentHash: hash,
      category: input.category ?? 'improvement',
      tags: JSON.stringify(allTags),
      confidence: input.confidence ?? 0.7,
      themeId,
      taskId: input.taskId ?? null,
      forgettingStage: 'active',
      decayScore: 1.0,
      validationStatus: 'pending',
    },
  });

  log.info({ id: entry.id, title: input.title }, 'Idea submitted');

  // Pipeline: enrich (Ollama) → review (Haiku) asynchronously, serialised via
  // the shared enrichment queue so bursts of submissions don't fire concurrent
  // local-LLM calls (which can spike CPU and starve foreground requests).
  import('./idea-extractor')
    .then(({ runEnrichAndReview }) => runEnrichAndReview(entry.id, input.title, input.content))
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
  /** Lifecycle filter: open = not yet turned into a task, used = already turned. */
  status?: 'open' | 'used' | 'all';
  /** Filter by priority level (urgent | high | medium | low). */
  priority?: string;
  limit?: number;
  offset?: number;
}): Promise<{ ideas: IdeaBoxEntry[]; total: number }> {
  const {
    categoryId,
    themeId,
    unusedOnly = false,
    scope,
    status,
    priority,
    limit = 20,
    offset = 0,
  } = options;

  const where = await buildWhereClause({
    categoryId,
    themeId,
    unusedOnly,
    scope,
    status,
    priority,
  });

  // PERF: project the FE-shown columns only. The default Prisma select
  // pulls every column from KnowledgeEntry — including `content` (often
  // multi-KB Markdown) and large JSON `tags` — which alone added ~50% of
  // the wire-transfer time for a 20-item page. `toIdeaBoxEntry` only
  // touches the 9 columns below.
  const [entries, total] = await Promise.all([
    prisma.knowledgeEntry.findMany({
      where,
      // Default to 起票順 (creation order, newest first) so the list is stable and
      // predictable, instead of reshuffling by AI confidence. (The auto-task
      // context picker below still ranks by confidence — that is a different need.)
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      skip: offset,
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        tags: true,
        confidence: true,
        themeId: true,
        taskId: true,
        sourceId: true,
        createdAt: true,
      },
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
  /** Innovation / value-uplift priority. Omit to keep the current value. */
  priority?: IdeaPriority;
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
  const userTags = (input.tags ?? existingTags).filter(
    (t) => !t.startsWith('scope:') && !t.startsWith('priority:'),
  );
  const nextScope: IdeaScope =
    input.scope ?? (nextThemeId !== null && nextThemeId !== undefined ? 'project' : 'global');
  // Keep the existing priority unless explicitly changed.
  const existingPriorityTag = existingTags.find((t) => t.startsWith('priority:'));
  const nextPriority = normalizeIdeaPriority(
    input.priority ?? existingPriorityTag?.slice('priority:'.length),
  );
  const nextTags = [...userTags, `scope:${nextScope}`, `priority:${nextPriority}`];

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
async function buildWhereClause(opts: {
  categoryId?: number;
  themeId?: number;
  unusedOnly?: boolean;
  scope?: IdeaScope;
  status?: 'open' | 'used' | 'all';
  priority?: string;
}) {
  const { categoryId, themeId, unusedOnly, scope, status, priority } = opts;
  // themeIdが直接指定されている場合はそれを優先、そうでなければcategoryIdからthemeIdsを取得
  let themeFilter: Record<string, unknown> = {};
  if (themeId) {
    themeFilter = { themeId };
  } else if (categoryId) {
    themeFilter = { themeId: { in: await getThemeIdsForCategory(categoryId) } };
  }

  // PERF: scope filtering used to be `tags: { contains: 'scope:project' }`.
  // That's a JSON-string substring LIKE on a non-indexable column and
  // performed a full scan over KnowledgeEntry — observed as a multi-second
  // freeze on the /ideas page when the user picked "プロジェクト" filter
  // with thousands of distilled rows in the table.
  //
  // The data invariant from `submitIdea` / `updateIdea` is:
  //   scope === 'project'  ↔  themeId IS NOT NULL
  //   scope === 'global'   ↔  themeId IS NULL
  // (both code paths derive scope from themeId presence when scope is
  // not explicitly provided, and the FE wires them together.) So we can
  // map the scope filter to themeId null-state, which uses the existing
  // foreign-key index and returns immediately.
  //
  // When themeFilter already pins a specific themeId / theme set, that
  // ALREADY implies project-scope, so we skip the redundant null-check
  // (and avoid a Prisma "themeId" key collision).
  let scopeFilter: Record<string, unknown> = {};
  if (scope && !themeId && !categoryId) {
    scopeFilter = scope === 'project' ? { themeId: { not: null } } : { themeId: null };
  } else if (scope === 'global' && (themeId || categoryId)) {
    // Logical contradiction — global ideas never have a theme. Force an
    // empty result rather than scanning anything.
    scopeFilter = { themeId: -1 };
  }

  // Lifecycle: an idea is "used" once it has been turned into a task
  // (markIdeaAsUsed sets sourceId to `used_task_<id>`). `status` takes
  // precedence over the legacy `unusedOnly` flag.
  const usedCond = { sourceId: { startsWith: 'used_task_' } };
  let statusFilter: Record<string, unknown> = {};
  if (status === 'used') statusFilter = usedCond;
  else if (status === 'open') statusFilter = { NOT: usedCond };
  else if (unusedOnly) statusFilter = { NOT: usedCond };

  // Priority is stored as a `priority:<level>` tag; ideas with no such tag are
  // shown as 'medium' (see toIdeaBoxEntry). To make the filter match what the UI
  // shows, 'medium' also matches ideas that have no priority tag at all. Other
  // levels match their explicit tag. Only filter when a level is requested.
  let priorityFilter: Record<string, unknown> = {};
  if (priority === 'medium') {
    priorityFilter = {
      OR: [{ tags: { contains: 'priority:medium' } }, { NOT: { tags: { contains: 'priority:' } } }],
    };
  } else if (priority) {
    priorityFilter = { tags: { contains: `priority:${priority}` } };
  }

  return {
    sourceType: 'idea_box' as const,
    forgettingStage: 'active',
    ...statusFilter,
    ...themeFilter,
    ...scopeFilter,
    ...priorityFilter,
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
  const priorityTag = parsedTags.find((t) => t.startsWith('priority:'));
  const priority = normalizeIdeaPriority(priorityTag?.slice('priority:'.length));
  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    category: entry.category,
    scope,
    priority,
    // Hide internal scope:/priority: markers from the FE-visible tag list.
    tags: parsedTags.filter((t) => !t.startsWith('scope:') && !t.startsWith('priority:')),
    confidence: entry.confidence,
    themeId: entry.themeId,
    taskId: entry.taskId,
    source: usedMatch ? 'used' : (entry.sourceId ?? 'user'),
    usedInTaskId: usedMatch ? parseInt(usedMatch[1]) : null,
    createdAt: entry.createdAt,
  };
}
