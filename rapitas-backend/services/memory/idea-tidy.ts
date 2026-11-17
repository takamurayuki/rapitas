/**
 * idea-tidy
 *
 * Tidying the idea box for ラピ: proposes gathering near-duplicate ideas under
 * the one to keep, and putting away ideas no longer needed (already turned
 * into a task, or old and low priority). Applying archives (forgettingStage
 * 'archived', which the idea list already hides), so an applied tidy can be
 * undone. Not responsible for deciding which sentence asks for this
 * (assistant/intent-router.ts).
 *
 * Why (2026-11-17): 「アイデアボックスのアイデアを整理して」 was routed to the
 * task tidy, because ラピ had no way to tidy ideas.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { isNearDuplicatePair } from './text-similarity';
import { IDEA_PRIORITIES, type IdeaPriority, normalizeIdeaPriority } from './idea-box-service';

const log = createLogger('idea-tidy');

/** Ideas older than this, at low priority, are offered to put away. */
const STALE_DAYS = 90;

/** How many ideas one proposal reads; the pairwise check is quadratic. */
const MAX_IDEAS = 400;

/** Characters of a merged idea's text carried into the one kept. */
const MERGED_EXCERPT = 200;

/** One idea as the tidy sees it. */
export interface TidyIdea {
  id: number;
  title: string;
  content: string;
  priority: IdeaPriority;
  /** Already turned into a task. */
  used: boolean;
  createdAt: Date;
}

/** A group of near-duplicates and the one to keep. */
export interface DuplicateGroup {
  keepId: number;
  /** Why they are one idea, when the model judged it (おまかせ). */
  reason?: string;
  ideas: Array<Pick<TidyIdea, 'id' | 'title' | 'priority'>>;
}

/** An idea offered to put away, and why. */
export interface UnneededIdea {
  id: number;
  title: string;
  reason: 'used' | 'stale' | 'judged';
  /** The model's reason, for a judged one. */
  note?: string;
}

/** What ラピ proposes. */
export interface IdeaTidyPlan {
  duplicates: DuplicateGroup[];
  unneeded: UnneededIdea[];
}

const rank = (p: IdeaPriority) => IDEA_PRIORITIES.indexOf(p);

/** The idea a group keeps: highest priority, then the fuller text, then the newest. */
function pickKeep(group: TidyIdea[]): TidyIdea {
  return [...group].sort(
    (a, b) =>
      rank(a.priority) - rank(b.priority) ||
      b.content.length - a.content.length ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
}

/**
 * Propose a tidy of the given ideas. Pure.
 *
 * @param ideas - Active ideas / 対象のアイデア
 * @param now - Current time / 現在時刻
 * @returns Duplicate groups and ideas to put away / 重複のまとまりと片付ける候補
 */
export function planIdeaTidy(ideas: TidyIdea[], now: Date): IdeaTidyPlan {
  const open = ideas.filter((i) => !i.used);
  const parent = new Map<number, number>(open.map((i) => [i.id, i.id]));
  const find = (id: number): number => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      if (isNearDuplicatePair(open[i], open[j])) parent.set(find(open[j].id), find(open[i].id));
    }
  }
  const groups = new Map<number, TidyIdea[]>();
  for (const i of open) {
    const root = find(i.id);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  }
  const duplicates: DuplicateGroup[] = [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      keepId: pickKeep(g).id,
      ideas: g.map(({ id, title, priority }) => ({ id, title, priority })),
    }));

  const grouped = new Set(duplicates.flatMap((g) => g.ideas.map((i) => i.id)));
  const staleBefore = now.getTime() - STALE_DAYS * 86_400_000;
  const unneeded: UnneededIdea[] = [];
  for (const i of ideas) {
    if (grouped.has(i.id)) continue;
    if (i.used) unneeded.push({ id: i.id, title: i.title, reason: 'used' });
    else if (i.priority === 'low' && i.createdAt.getTime() < staleBefore) {
      unneeded.push({ id: i.id, title: i.title, reason: 'stale' });
    }
  }
  return { duplicates, unneeded };
}

/**
 * The active ideas, newest first.
 *
 * @param themeId - Limit to one theme, when given / テーマで絞る
 * @returns Ideas as the tidy sees them / 整理対象のアイデア
 */
export async function loadActiveIdeas(themeId?: number): Promise<TidyIdea[]> {
  const rows = await prisma.knowledgeEntry.findMany({
    where: {
      sourceType: 'idea_box',
      forgettingStage: 'active',
      ...(themeId !== undefined ? { themeId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_IDEAS,
    select: { id: true, title: true, content: true, tags: true, sourceId: true, createdAt: true },
  });
  return rows.map((r): TidyIdea => {
    const tags = JSON.parse(r.tags || '[]') as string[];
    const priorityTag = tags.find((t) => t.startsWith('priority:'));
    return {
      id: r.id,
      title: r.title,
      content: r.content,
      priority: normalizeIdeaPriority(priorityTag?.slice('priority:'.length)),
      used: /^used_task_\d+$/.test(r.sourceId ?? ''),
      createdAt: r.createdAt,
    };
  });
}

/**
 * Read the active ideas and propose a tidy by the rules.
 *
 * @param themeId - Limit to one theme, when given / テーマで絞る
 * @returns The proposal / 提案
 */
export async function proposeIdeaTidy(themeId?: number): Promise<IdeaTidyPlan> {
  return planIdeaTidy(await loadActiveIdeas(themeId), new Date());
}

/** What the person confirmed. */
export interface IdeaTidyRequest {
  merges: Array<{ keepId: number; mergeIds: number[] }>;
  archiveIds: number[];
}

/** What an applied tidy changed, enough to undo it. */
export interface IdeaTidyResult {
  archivedIds: number[];
  previousContents: Array<{ id: number; content: string }>;
}

/**
 * Apply a confirmed tidy: merged ideas are named in the one kept and then
 * archived with the ideas put away.
 *
 * @param req - Confirmed merges and ideas to put away / 確認済みの統合と片付け
 * @returns What changed, for undo / 取り消し用の変更内容
 */
export async function applyIdeaTidy(req: IdeaTidyRequest): Promise<IdeaTidyResult> {
  const mergeIds = req.merges.flatMap((m) => m.mergeIds);
  const ids = [...new Set([...req.merges.map((m) => m.keepId), ...mergeIds])];
  const rows =
    ids.length > 0
      ? await prisma.knowledgeEntry.findMany({
          where: { id: { in: ids }, sourceType: 'idea_box' },
          select: { id: true, title: true, content: true },
        })
      : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const archivedIds = [...new Set([...mergeIds, ...req.archiveIds])];
  const previousContents: IdeaTidyResult['previousContents'] = [];

  await prisma.$transaction(async (tx) => {
    for (const m of req.merges) {
      const keep = byId.get(m.keepId);
      const merged = m.mergeIds.map((id) => byId.get(id)).filter((r) => r !== undefined);
      if (!keep || merged.length === 0) continue;
      const lines = merged.map(
        (r) => `- ${r.title}${r.content ? `: ${r.content.slice(0, MERGED_EXCERPT)}` : ''}`,
      );
      previousContents.push({ id: keep.id, content: keep.content });
      await tx.knowledgeEntry.update({
        where: { id: keep.id },
        data: { content: `${keep.content}\n\n## まとめたアイデア\n${lines.join('\n')}` },
      });
    }
    if (archivedIds.length > 0) {
      await tx.knowledgeEntry.updateMany({
        where: { id: { in: archivedIds }, sourceType: 'idea_box' },
        data: { forgettingStage: 'archived' },
      });
    }
  });
  log.info({ archived: archivedIds.length, merged: previousContents.length }, 'Idea tidy applied');
  return { archivedIds, previousContents };
}

/**
 * Undo an applied tidy.
 *
 * @param done - What the tidy changed / 適用時の変更内容
 */
export async function undoIdeaTidy(done: IdeaTidyResult): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (done.archivedIds.length > 0) {
      await tx.knowledgeEntry.updateMany({
        where: { id: { in: done.archivedIds }, sourceType: 'idea_box' },
        data: { forgettingStage: 'active' },
      });
    }
    for (const p of done.previousContents) {
      await tx.knowledgeEntry.update({ where: { id: p.id }, data: { content: p.content } });
    }
  });
  log.info({ restored: done.archivedIds.length }, 'Idea tidy undone');
}
