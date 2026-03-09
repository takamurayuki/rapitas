/**
 * ベクトル類似検索
 * embeddingを生成してコサイン類似度で検索、forgettingStageでフィルタ
 */
import { createLogger } from "../../../config/logger";
import { prisma } from "../../../config/database";
import { generateEmbedding } from "./embedding";
import { searchSimilar } from "./vector-index";
import { boostDecayOnAccess } from "../forgetting";
import type { VectorSearchResult, KnowledgeSearchOptions } from "../types";

const log = createLogger("memory:rag:search");

/**
 * ベクトル類似検索（テキストクエリから）
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
 * 知識ベース検索（ベクトル検索 + DBフィルタ）
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
  const {
    query,
    limit = 10,
    minSimilarity = 0.5,
    forgettingStage,
    category,
    themeId,
  } = options;

  // ベクトル検索で候補を取得（多めに）
  const vectorResults = await vectorSearch({
    query,
    limit: limit * 3,
    minSimilarity,
  });

  if (vectorResults.length === 0) return [];

  // DBフィルタ条件を構築
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

  // ベクトル検索結果とDB結果をマージ
  const similarityMap = new Map(vectorResults.map((r) => [r.knowledgeEntryId, r.similarity]));

  const results = entries
    .map((e) => ({
      ...e,
      similarity: similarityMap.get(e.id) ?? 0,
      tags: JSON.parse(e.tags) as string[],
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  // アクセスカウントとdecay回復（非同期、失敗しても無視）
  for (const entry of results) {
    boostDecayOnAccess(entry.id).catch(() => {});
  }

  return results;
}
