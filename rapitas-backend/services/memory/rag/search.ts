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
    },
  });

  // Merge vector search results with DB results
  const similarityMap = new Map(vectorResults.map((r) => [r.knowledgeEntryId, r.similarity]));

  const results = entries
    .map((e) => ({
      ...e,
      similarity: similarityMap.get(e.id) ?? 0,
      tags: JSON.parse(e.tags) as string[],
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  // Boost access count and decay (async, fire-and-forget)
  for (const entry of results) {
    boostDecayOnAccess(entry.id).catch(() => {});
  }

  return results;
}
