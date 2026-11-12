/**
 * idea-box-where-clause
 *
 * Builds the Prisma where clause for IdeaBox list queries (theme / category / scope /
 * status / priority / search filters) and resolves a category's theme ids.
 * It does not run the list query itself or map rows (see idea-box-service).
 */
import { prisma } from '../../config/database';
import { buildIdeaSearchFilter } from './idea-box-search';
import type { IdeaScope } from './idea-box-service';

/**
 * Resolve themeIds belonging to a category.
 * KnowledgeEntry has themeId (Int) but no theme relation, so we query Theme first.
 *
 * @param categoryId - Category to resolve / 対象カテゴリID
 * @returns Theme ids in that category / カテゴリに属するテーマID一覧
 */
export async function getThemeIdsForCategory(categoryId: number): Promise<number[]> {
  const themes = await prisma.theme.findMany({
    where: { categoryId },
    select: { id: true },
  });
  return themes.map((t) => t.id);
}

/**
 * Build the Prisma where clause for idea list queries (listIdeas).
 *
 * @param opts - List filters / 一覧のフィルタ条件
 * @returns Prisma KnowledgeEntry where clause / Prismaのwhere句
 */
export async function buildWhereClause(opts: {
  categoryId?: number;
  themeId?: number;
  noTheme?: boolean;
  unusedOnly?: boolean;
  scope?: IdeaScope;
  status?: 'open' | 'used' | 'all';
  priority?: string;
  search?: string;
}) {
  const { categoryId, themeId, noTheme, unusedOnly, scope, status, priority } = opts;
  // themeIdが直接指定されている場合はそれを優先、そうでなければcategoryIdからthemeIdsを取得
  // NOTE: noTheme（GET /idea-box?themeId=none）はテーマ未定のアイデアだけを返す。数値 themeId の解釈は変えない。
  let themeFilter: Record<string, unknown> = {};
  if (noTheme) {
    themeFilter = { themeId: null };
  } else if (themeId) {
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
  if (noTheme) {
    // Themeless ideas are global by the invariant above; 'project' can never match.
    if (scope === 'project') scopeFilter = { themeId: -1 };
  } else if (scope && !themeId && !categoryId) {
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
    ...buildIdeaSearchFilter(opts.search),
  };
}
