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
import { createLogger } from '../../config/logger';
import { generateEmbedding } from './rag/embedding';
import { searchSimilar } from './rag/vector-index';

const log = createLogger('memory:dedup');

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
): Promise<number | null> {
  if (!content.trim()) return null;
  try {
    const { embedding } = await generateEmbedding(content);
    const hits = searchSimilar(embedding, 1, DEDUP_THRESHOLD, excludeIds);
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
