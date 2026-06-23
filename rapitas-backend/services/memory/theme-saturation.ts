/**
 * theme-saturation
 *
 * Shared anti-monoculture gate for the idea box and concern backlog. Embedding
 * cosine (all-MiniLM-L6-v2) proved useless for Japanese near-duplicate detection
 * (novel ideas scored HIGHER than near-dups), so this uses a LEXICAL signal:
 * reject a new title that shares a long-enough substring with too many existing
 * entries of the same kind — i.e. the theme is already over-represented, or the
 * item is a near-duplicate re-file. Self-contained (no embeddings); reliable for
 * the observed monoculture where titles literally share 「型ガード」/「SSOT」/
 * 「gen:type-guards」/「Prettier」. Not responsible for creating/deleting entries.
 */
import { prisma } from '../../config/database';

/** Longest common substring length between two strings (small inputs only). */
export function lcsLen(a: string, b: string): number {
  if (!a || !b) return 0;
  const prev = new Array<number>(b.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      if (a[i - 1] === b[j - 1]) {
        prev[j] = diag + 1;
        if (prev[j] > best) best = prev[j];
      } else prev[j] = 0;
      diag = tmp;
    }
  }
  return best;
}

/** Options selecting which KB entries form the saturation pool and the thresholds. */
export interface SaturationOptions {
  /** KnowledgeEntry.sourceType to scan (e.g. 'idea_box' | 'concern'). */
  sourceType: string;
  /** Reject once this many existing entries share a salient substring. */
  cap: number;
  /** Minimum shared-substring length that counts as "same theme". */
  salient: number;
  /** When true, restrict the pool to OPEN concerns (sourceId='open'). */
  openConcernOnly?: boolean;
}

/**
 * Find an existing entry that anchors an over-represented theme for `title`, or
 * null when the title is novel enough to admit. Returns the first matching id so
 * callers can treat a hit as a no-op dedup (point at the existing item).
 *
 * @param title - Candidate entry title. / 候補タイトル
 * @param opts - Pool + thresholds. / 対象プールと閾値
 * @returns Anchor id when saturated, else null. / 飽和時はID、それ以外 null
 */
export async function findSaturatedTheme(
  title: string,
  opts: SaturationOptions,
): Promise<number | null> {
  const { sourceType, cap, salient, openConcernOnly } = opts;
  if (title.trim().length < salient) return null;
  const where: { sourceType: string; sourceId?: string } = { sourceType };
  if (openConcernOnly) where.sourceId = 'open';
  const rows = await prisma.knowledgeEntry
    .findMany({ where, select: { id: true, title: true }, take: 600 })
    .catch(() => [] as { id: number; title: string }[]);
  let matches = 0;
  let anchor: number | null = null;
  for (const e of rows) {
    if (lcsLen(title, e.title) >= salient) {
      matches += 1;
      anchor = anchor ?? e.id;
      if (matches >= cap) return anchor;
    }
  }
  return null;
}
