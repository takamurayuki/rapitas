/**
 * dedup
 *
 * Write-time semantic de-duplication for the knowledge base. Before inserting a
 * new entry, check whether a near-identical one already exists (cosine on the
 * embedding). If so, the caller REINFORCES the existing entry instead of adding
 * a paraphrase — this stops the "11 near-duplicate notes per task" bloat at the
 * source (the brain reinforces an existing memory rather than storing a new copy
 * of the same fact).
 *
 * Exact-hash duplicates are cheaper to catch with contentHash and are handled by
 * callers; this module owns the SEMANTIC (different-wording, same-meaning) case.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { generateEmbedding } from './rag/embedding';
import { searchSimilar } from './rag/vector-index';
import { isNearDuplicatePair } from './text-similarity';

const log = createLogger('memory:dedup');

/** How many recent active entries the lexical fallback scans per write. */
const LEXICAL_SCAN_LIMIT = 300;

/**
 * Cosine similarity at/above which two entries are treated as the same fact.
 * 0.9 is deliberately conservative — only collapse clear paraphrases, never
 * merge merely-related knowledge. Tunable via RAPITAS_KB_DEDUP_THRESHOLD.
 */
const DEDUP_THRESHOLD = (() => {
  const v = parseFloat(process.env.RAPITAS_KB_DEDUP_THRESHOLD ?? '0.9');
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.9;
})();

/**
 * Find an existing knowledge entry that is a semantic duplicate of `content`.
 *
 * Best-effort: if embeddings are unavailable (subprocess failure / disabled), it
 * returns null so the caller still inserts — losing dedup is acceptable, blocking
 * a knowledge write is not.
 *
 * @param content - The candidate entry's content. / 追加候補の本文
 * @param excludeIds - Entry ids to ignore (e.g. self on update). / 除外ID
 * @returns The duplicate entry's id, or null when none is close enough. / 重複ID or null
 */
export async function findSemanticDuplicate(
  content: string,
  excludeIds: number[] = [],
  threshold: number = DEDUP_THRESHOLD,
): Promise<number | null> {
  if (!content.trim()) return null;
  try {
    const { embedding } = await generateEmbedding(content);
    const hits = searchSimilar(embedding, 1, threshold, excludeIds);
    if (hits.length > 0) {
      log.debug(
        { dupId: hits[0].knowledgeEntryId, similarity: hits[0].similarity },
        '[kb-dedup] Semantic duplicate found — caller should reinforce instead of insert',
      );
      return hits[0].knowledgeEntryId;
    }
    return null;
  } catch (err) {
    // Embeddings unavailable — skip dedup rather than block the write.
    log.debug({ err }, '[kb-dedup] Embedding unavailable; skipping semantic dedup');
    return null;
  }
}

/**
 * Find an existing entry that is a LEXICAL near-duplicate (bigram-Jaccard) of
 * the candidate. Complements findSemanticDuplicate: embedding cosine is
 * unreliable for Japanese paraphrases (the observed failure mode behind the
 * 8,883-row contradiction backlog was the same lesson being written over and
 * over past the cosine gate). Scans the most recent active entries only —
 * duplicate lessons arrive in bursts, so recency covers the real cases at
 * O(limit) cost per write.
 *
 * Best-effort: any failure returns null so a dedup hiccup never blocks a write.
 *
 * @param title - Candidate entry title. / 追加候補のタイトル
 * @param content - Candidate entry content. / 追加候補の本文
 * @param excludeIds - Entry ids to ignore (e.g. self on update). / 除外ID
 * @returns The duplicate entry's id, or null. / 重複ID or null
 */
export async function findLexicalDuplicate(
  title: string,
  content: string,
  excludeIds: number[] = [],
): Promise<number | null> {
  if (!title.trim() && !content.trim()) return null;
  try {
    const recent = await prisma.knowledgeEntry.findMany({
      where: {
        forgettingStage: { not: 'archived' },
        validationStatus: { not: 'rejected' },
        ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
      },
      select: { id: true, title: true, content: true },
      orderBy: { id: 'desc' },
      take: LEXICAL_SCAN_LIMIT,
    });
    const candidate = { title, content };
    for (const entry of recent) {
      if (isNearDuplicatePair(candidate, entry)) {
        log.debug(
          { dupId: entry.id, title },
          '[kb-dedup] Lexical near-duplicate found — caller should reinforce instead of insert',
        );
        return entry.id;
      }
    }
    return null;
  } catch (err) {
    log.debug({ err }, '[kb-dedup] Lexical dedup failed; skipping');
    return null;
  }
}
