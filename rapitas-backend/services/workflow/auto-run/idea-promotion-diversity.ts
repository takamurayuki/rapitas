/**
 * idea-promotion-diversity
 *
 * Diversity selection for idea→task promotion (anti-monoculture at the LAST
 * gate). Ideas are listed newest-first, and the idea-extractor files ideas
 * derived from the task just executed — so naive top-N promotion turns one
 * task's flavor into the next several tasks, which generate more same-flavored
 * ideas: a feedback loop. The submit-time gates (lexical dedup, QD judge)
 * reject duplicates but nothing spaced out WHAT GETS PROMOTED. This module
 * picks a batch that is dissimilar to (a) recently promoted idea-tasks and
 * (b) each other, and spans QD cells — a greedy max-diversity subset
 * (k-DPP-style selection, arXiv:2509.04784). Pure selection only; the
 * promoter does the actual task creation.
 */
import type { PrismaClient } from '@prisma/client';
import { bigramJaccard } from '../../memory/theme-saturation';

/** Similarity at/above this to any anchor disqualifies a candidate (strict pass). */
const SIM_THRESHOLD = 0.35;
/** Recently promoted idea-tasks used as anchors. */
const RECENT_PROMOTED_WINDOW = 10;

/** Minimal idea fields required for diversity selection. */
export interface DiversifiableIdea {
  id: number;
  title: string;
  content: string;
  /** KnowledgeEntry tags — optional so partial callers/rows never crash. */
  tags?: string[];
}

/** Extract the QD grid cell from an idea's tags (R5 `cell:` tag). */
export function ideaCell(tags: string[] | undefined): string | null {
  const t = (tags ?? []).find((x) => typeof x === 'string' && x.startsWith('cell:'));
  return t ? t.slice('cell:'.length) : null;
}

/**
 * Pick up to `n` ideas that are mutually diverse AND dissimilar to recently
 * promoted tasks. Pure and unit-testable.
 *
 * Strict pass: a candidate is skipped when its title is lexically similar
 * (bigram Jaccard >= threshold) to any recent promoted title or any already
 * picked idea, or when it shares a QD cell with an already picked idea.
 * Fill pass: when the strict pass yields fewer than `n`, remaining slots are
 * filled in input order from the skipped ones — promotion must never deadlock
 * just because the whole backlog is one flavor (that starvation is itself a
 * signal, surfaced via `fallbackUsed`).
 *
 * @param ideas - Candidates in the promoter's preference order. / 候補（優先順）
 * @param recentPromotedTitles - Titles of recently promoted idea-tasks. / 直近起票タイトル
 * @param n - Max ideas to select. / 採択数
 * @returns Picked ideas + diagnostics. / 採択結果と診断
 */
export function pickDiverseIdeas<T extends DiversifiableIdea>(
  ideas: T[],
  recentPromotedTitles: string[],
  n: number,
): { picked: T[]; skippedAsSimilar: number; fallbackUsed: boolean } {
  if (n <= 0 || ideas.length === 0) {
    return { picked: [], skippedAsSimilar: 0, fallbackUsed: false };
  }

  // Anchor probes: recent promoted tasks (with the [Idea] prefix stripped).
  const anchors = recentPromotedTitles.map((t) => t.replace(/^\[Idea\]\s*/i, ''));

  const picked: T[] = [];
  const skipped: T[] = [];
  const pickedCells = new Set<string>();

  for (const idea of ideas) {
    if (picked.length >= n) break;
    const probe = idea.title;
    const cell = ideaCell(idea.tags);

    const similarToAnchor = anchors.some((a) => bigramJaccard(probe, a) >= SIM_THRESHOLD);
    const similarToPicked = picked.some((p) => bigramJaccard(probe, p.title) >= SIM_THRESHOLD);
    const cellCollision = cell != null && pickedCells.has(cell);

    if (similarToAnchor || similarToPicked || cellCollision) {
      skipped.push(idea);
      continue;
    }
    picked.push(idea);
    if (cell) pickedCells.add(cell);
  }

  const skippedAsSimilar = skipped.length;
  let fallbackUsed = false;
  // Fill pass: keep the pipeline moving even when everything is one flavor.
  for (const idea of skipped) {
    if (picked.length >= n) break;
    picked.push(idea);
    fallbackUsed = true;
  }

  return { picked, skippedAsSimilar, fallbackUsed };
}

/**
 * Titles of the theme's recently promoted idea-tasks (any status — an OPEN
 * pile of same-flavored tasks is exactly the bias to space away from).
 * Best-effort: empty on failure.
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param themeId - Theme scope. / テーマ
 * @returns Recent `[Idea] …` task titles. / 直近のアイデア起票タスクのタイトル
 */
export async function getRecentIdeaTaskTitles(
  prisma: PrismaClient,
  themeId: number,
): Promise<string[]> {
  try {
    const rows = await prisma.task.findMany({
      where: {
        themeId,
        autoCreatedFromBacklog: true,
        title: { startsWith: '[Idea]' },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: RECENT_PROMOTED_WINDOW,
      select: { title: true },
    });
    return rows.map((r) => r.title);
  } catch {
    return [];
  }
}
