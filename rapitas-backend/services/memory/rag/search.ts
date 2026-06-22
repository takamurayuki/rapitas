/**
 * Vector Similarity Search
 *
 * Generates embeddings, searches by cosine similarity, and filters by forgettingStage.
 */
import { createLogger } from '../../../config/logger';
import { prisma } from '../../../config/database';
import { generateEmbedding } from './embedding';
import { searchSimilar } from './vector-index';
import { boostDecayOnAccess } from '../forgetting';
import type { VectorSearchResult, KnowledgeSearchOptions } from '../types';

const log = createLogger('memory:rag:search');

/**
 * Vector similarity search from a text query.
 */
export async function vectorSearch(options: {
  query: string;
  limit?: number;
  minSimilarity?: number;
  excludeIds?: number[];
}): Promise<VectorSearchResult[]> {
  const { query, limit = 10, minSimilarity = 0.5, excludeIds = [] } = options;

  const { embedding } = await generateEmbedding(query);
  return searchSimilar(embedding, limit, minSimilarity, excludeIds);
}

/**
 * Search the knowledge base (vector search + DB filtering).
 */
export async function searchKnowledge(options: KnowledgeSearchOptions): Promise<
  Array<{
    id: number;
    title: string;
    content: string;
    category: string;
    confidence: number;
    forgettingStage: string;
    similarity: number;
    tags: string[];
    createdAt: Date;
    /** Source task this entry was learned from (for outcome-weighted recall). */
    taskId: number | null;
    /** KB validation state — lets callers label/trust recalled knowledge. */
    validationStatus: string;
  }>
> {
  const { query, limit = 10, minSimilarity = 0.5, forgettingStage, category, themeId } = options;

  // Fetch extra candidates via vector search for post-filtering
  const vectorResults = await vectorSearch({
    query,
    limit: limit * 3,
    minSimilarity,
  });

  if (vectorResults.length === 0) return [];

  // Build DB filter conditions
  const entryIds = vectorResults.map((r) => r.knowledgeEntryId);
  const where: Record<string, unknown> = {
    id: { in: entryIds },
    // Never recall REFUTED knowledge as guidance — it has been disproven (e.g. a
    // refuted hypothesis). Surfacing it would teach the agent a known-wrong lesson.
    validationStatus: { not: 'rejected' },
  };
  if (forgettingStage) where.forgettingStage = forgettingStage;
  if (category) where.category = category;
  if (themeId) where.themeId = themeId;

  const entries = await prisma.knowledgeEntry.findMany({
    where,
    select: {
      id: true,
      title: true,
      content: true,
      category: true,
      confidence: true,
      forgettingStage: true,
      tags: true,
      createdAt: true,
      taskId: true,
      validationStatus: true,
    },
  });

  // Merge vector search results with DB results
  const similarityMap = new Map(vectorResults.map((r) => [r.knowledgeEntryId, r.similarity]));

  // Trust-weight the ranking by the KB's own validation state so RELIABLE
  // knowledge wins the limited prompt slots: proven (validated) is boosted, while
  // CONTESTED (conflict — 1 of a contradicting pair, possibly wrong) is demoted so
  // it rarely displaces a clean entry. With ~31% of the KB in conflict, injecting
  // them unweighted fed the agent contradictory lessons. `similarity` stays the
  // true cosine for callers; only the sort order (and thus the top-`limit`) shifts.
  const TRUST_WEIGHT: Record<string, number> = { validated: 1.25, pending: 1.0, conflict: 0.5 };
  const results = entries
    .map((e) => {
      const similarity = similarityMap.get(e.id) ?? 0;
      return {
        ...e,
        similarity,
        rankScore: similarity * (TRUST_WEIGHT[e.validationStatus] ?? 1.0),
        tags: JSON.parse(e.tags) as string[],
      };
    })
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, limit)
    .map(({ rankScore: _rankScore, ...rest }) => rest);

  // Retrieval is only a WEAK signal — being surfaced is not proof of usefulness.
  // Apply a small boost here; the STRONG reward is applied at task outcome by
  // outcome-reinforcement (boost on success / penalty on failure), so what
  // survives the forgetting curve is what actually helped, not what was popular.
  for (const entry of results) {
    boostDecayOnAccess(entry.id, 0.05).catch(() => {});
  }

  return results;
}
