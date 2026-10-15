/**
 * Vector Similarity Search
 *
 * Generates embeddings, searches by cosine similarity (scoped to the model the
 * query was embedded with), and filters by forgettingStage(s). This is the
 * VECTOR channel of recall; the lexical channel and their fusion live in
 * ../recall/ and call into this module.
 */
import { prisma } from '../../../config/database';
import { generateEmbedding } from './embedding';
import { searchSimilar } from './vector-index';
import { parseTagsAsStrings } from '../utils';
import { getRecallConfig } from '../recall/recall-config';
import type { VectorSearchResult, KnowledgeSearchOptions, ForgettingStage } from '../types';

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

  const { embedding, model } = await generateEmbedding(query);
  // NOTE: scope the scan to rows embedded by the SAME model — during a model
  // migration, cosine against another model's vectors is meaningless.
  return searchSimilar(embedding, limit, minSimilarity, excludeIds, model);
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
  const {
    query,
    limit = 10,
    minSimilarity = 0.5,
    forgettingStage,
    category,
    themeId,
    stageWeights,
    candidateMultiplier,
  } = options;

  // Fetch extra candidates via vector search for post-filtering. The pool
  // multiplier is configurable (RAPITAS_KB_RECALL_CANDIDATE_MULTIPLIER) because
  // theme/category filtering below can discard most of a small pool.
  const multiplier = candidateMultiplier ?? getRecallConfig().candidateMultiplier;
  const vectorResults = await vectorSearch({
    query,
    limit: limit * multiplier,
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
  if (Array.isArray(forgettingStage)) {
    if (forgettingStage.length > 0) where.forgettingStage = { in: forgettingStage };
  } else if (forgettingStage) {
    where.forgettingStage = forgettingStage;
  }
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
    // NOTE: no meaningful ranking column here (rankScore is computed in JS
    // below) — an explicit id order keeps the pre-rank candidate set stable
    // across identical calls so the same prompt always sees the same context.
    orderBy: { id: 'asc' },
  });

  // Merge vector search results with DB results
  const similarityMap = new Map(vectorResults.map((r) => [r.knowledgeEntryId, r.similarity]));

  // Trust-weight the ranking by the KB's own validation state so RELIABLE
  // knowledge wins the limited prompt slots: proven (validated) is boosted, while
  // CONTESTED (conflict — 1 of a contradicting pair, possibly wrong) is demoted so
  // it rarely displaces a clean entry. With ~31% of the KB in conflict, injecting
  // them unweighted fed the agent contradictory lessons. `similarity` stays the
  // true cosine for callers; only the sort order (and thus the top-`limit`) shifts.
  // Stage weight (active 1 / dormant / archived < 1 by config) is a second
  // ORDERING multiplier so a stale archived lesson does not displace an equally
  // similar active one, while still remaining a candidate.
  const TRUST_WEIGHT: Record<string, number> = { validated: 1.25, pending: 1.0, conflict: 0.5 };
  const results = entries
    .map((e) => {
      const similarity = similarityMap.get(e.id) ?? 0;
      const stageWeight = stageWeights?.[e.forgettingStage as ForgettingStage] ?? 1.0;
      return {
        ...e,
        similarity,
        rankScore: similarity * (TRUST_WEIGHT[e.validationStatus] ?? 1.0) * stageWeight,
        tags: parseTagsAsStrings(e.tags),
      };
    })
    // Tie-break on id: two entries can land on the exact same rankScore (e.g.
    // both TRUST_WEIGHT-boosted to an identical value), and Array#sort is not
    // guaranteed stable across engines/versions for equal keys — pinning the
    // tie order to id keeps the top-`limit` slice (and thus the prompt) the
    // same across repeated runs of the same query.
    .sort((a, b) => b.rankScore - a.rankScore || a.id - b.id)
    .slice(0, limit)
    .map(({ rankScore: _rankScore, ...rest }) => rest);

  // NOTE (determinism): this function used to fire-and-forget a small
  // boostDecayOnAccess() on every returned entry as a "weak retrieval signal".
  // That mutated decayScore/accessCount/forgettingStage on READ, so a dormant
  // entry could cross the 'active' threshold mid-run and change what a
  // SUBSEQUENT retrieval in the same task (e.g. the verify phase re-querying
  // after the research phase already read) would see — the same prompt could
  // then produce a different context depending on timing. The outcome-gated
  // path (recordRetrieval + applyOutcomeReinforcement in
  // ../../memory/outcome-reinforcement.ts, wired from
  // workflow-memory-context.ts) already reinforces/decays these exact entries
  // once the task reaches a terminal outcome — reads no longer mutate state.
  return results;
}
