/**
 * knowledge-stats
 *
 * Aggregates the knowledge-base statistics exposed by `GET /knowledge/stats`:
 * counts by category / stage / validation / source, averages, the open
 * contradiction count, injected-knowledge effectiveness, recall attempt
 * metrics, and the embedding-index migration status. Read-only.
 */
import { prisma } from '../../config/database';
import { getKnowledgeEffectiveness } from './effectiveness';
import { getRecallMetrics } from './recall/recall-metrics';
import { getEmbeddingIndexStatus } from './rag/reindex';
import type { RecallMetrics } from './recall/recall-metrics';
import type { EmbeddingIndexStatus } from './rag/reindex';

/** Recall attempts window surfaced in the stats payload (days). */
const RECALL_WINDOW_DAYS = 7;

/**
 * Retrieve knowledge entry statistics.
 *
 * @returns Aggregate statistics including recall + embedding index status. / 統計値
 */
export async function getKnowledgeStats() {
  const [
    totalEntries,
    byCategory,
    byStage,
    byValidation,
    bySource,
    avgConfidence,
    avgDecay,
    recentlyAccessed,
    unresolvedContradictions,
    effectiveness,
    recall,
    embeddingIndex,
  ] = await Promise.all([
    prisma.knowledgeEntry.count(),
    prisma.knowledgeEntry.groupBy({ by: ['category'], _count: { id: true } }),
    prisma.knowledgeEntry.groupBy({ by: ['forgettingStage'], _count: { id: true } }),
    prisma.knowledgeEntry.groupBy({ by: ['validationStatus'], _count: { id: true } }),
    prisma.knowledgeEntry.groupBy({ by: ['sourceType'], _count: { id: true } }),
    prisma.knowledgeEntry.aggregate({ _avg: { confidence: true } }),
    prisma.knowledgeEntry.aggregate({ _avg: { decayScore: true } }),
    prisma.knowledgeEntry.count({
      where: { lastAccessedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }),
    // Convergence signal for the nightly sweeps: byValidation shows the mix,
    // but only the open-contradiction count says whether the backlog is
    // actually draining toward zero.
    prisma.knowledgeContradiction.count({ where: { resolution: null } }),
    getKnowledgeEffectiveness(),
    // Both are best-effort: a failure must not take the whole stats call down.
    getRecallMetrics(RECALL_WINDOW_DAYS),
    getEmbeddingIndexStatus().catch(
      (): EmbeddingIndexStatus => ({
        activeModel: null,
        configuredModel: '',
        byModel: {},
        total: 0,
        pendingReindex: 0,
      }),
    ),
  ]);

  const toRecord = (
    items: Array<{ _count: { id: number }; [key: string]: unknown }>,
    key: string,
  ) => Object.fromEntries(items.map((i) => [i[key], i._count.id]));

  return {
    totalEntries,
    byCategory: toRecord(byCategory, 'category'),
    byStage: toRecord(byStage, 'forgettingStage'),
    byValidation: toRecord(byValidation, 'validationStatus'),
    bySource: toRecord(bySource, 'sourceType'),
    averageConfidence: avgConfidence._avg.confidence ?? 0,
    averageDecayScore: avgDecay._avg.decayScore ?? 0,
    recentlyAccessed,
    unresolvedContradictions,
    effectiveness,
    recall: recall as RecallMetrics,
    embeddingIndex,
  };
}
