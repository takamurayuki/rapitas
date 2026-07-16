/**
 * Learning Statistics Operations
 *
 * Aggregation and reporting functions: learning stats summary,
 * growth timeline over configurable periods, and memory overview.
 * Pattern and prompt evolution operations live in separate modules.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import type { LearningStats, MemoryOverview } from './types';

const log = createLogger('self-learning:learning');

/**
 * Returns aggregate learning statistics including experiment counts,
 * top patterns, recent learnings, and knowledge graph size.
 *
 * @returns LearningStats summary object / 学習統計サマリーオブジェクト
 */
export async function getLearningStats(): Promise<LearningStats> {
  const [
    totalExperiments,
    completedExperiments,
    topPatterns,
    promptImprovements,
    nodeCount,
    edgeCount,
  ] = await Promise.all([
    prisma.experiment.count(),
    prisma.experiment.count({ where: { status: 'completed' } }),
    prisma.learningPattern.findMany({
      orderBy: { occurrences: 'desc' },
      take: 5,
      select: { id: true, description: true, occurrences: true },
    }),
    prisma.promptEvolution.count(),
    prisma.knowledgeGraphNode.count(),
    prisma.knowledgeGraphEdge.count(),
  ]);

  const recentExperiments = await prisma.experiment.findMany({
    where: { status: 'completed', learning: { not: null } },
    orderBy: { completedAt: 'desc' },
    take: 5,
    select: { learning: true },
  });

  const recentLearnings = (recentExperiments as Array<{ learning: string | null }>)
    .map((e) => {
      const learning = JSON.parse(e.learning!);
      return learning.improvements?.[0] ?? learning.newKnowledge?.[0] ?? null;
    })
    .filter(Boolean) as string[];

  return {
    totalExperiments,
    successRate: totalExperiments > 0 ? completedExperiments / totalExperiments : 0,
    topPatterns,
    recentLearnings,
    promptImprovements,
    knowledgeGraphSize: { nodes: nodeCount, edges: edgeCount },
  };
}

// NOTE: getGrowthTimeline moved to ./growth-timeline.ts — rewritten from a
// 7-queries-per-day loop to bulk fetch + pure bucketing, and the confidence
// series changed from a cumulative successes-only mean (constant by
// construction) to a 7-day trailing window over terminal experiments.

/** Memory strength score plus its display level. */
export interface MemoryStrength {
  score: number;
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
}

/**
 * Compute the memory-strength score from asymptotic (half-saturation) curves.
 * Pure function exported for unit tests.
 *
 * NOTE: The previous linear formula (`nodes*0.3 + patterns*0.4 + …`) pinned
 * the score at 100/"expert" permanently once ~250 patterns existed — the card
 * could never move again in either direction. Each x/(x+k) term approaches
 * its weight asymptotically instead, so growth keeps registering and the
 * success-rate term (30%) can still pull the score down after a bad streak.
 *
 * @param counts - Current memory sizes. / 現在の記憶量
 * @param successRate - Completed / total experiments (0-1). / 実験成功率
 * @returns Score (0-100) and level band. / スコアとレベル
 */
export function computeMemoryStrength(
  counts: { nodes: number; patterns: number; episodes: number },
  successRate: number,
): MemoryStrength {
  const half = (x: number, k: number) => x / (x + k);
  const score = Math.min(
    100,
    Math.floor(
      25 * half(counts.nodes, 50) +
        25 * half(counts.patterns, 300) +
        30 * Math.max(0, Math.min(1, successRate)) +
        20 * half(counts.episodes, 200),
    ),
  );

  let level: MemoryStrength['level'];
  if (score < 25) level = 'beginner';
  else if (score < 50) level = 'intermediate';
  else if (score < 75) level = 'advanced';
  else level = 'expert';
  return { score, level };
}

/**
 * Returns a comprehensive memory overview including growth rates,
 * memory strength score, knowledge distribution, and recent highlights.
 *
 * @returns MemoryOverview object / メモリ概要オブジェクト
 */
export async function getMemoryOverview(): Promise<MemoryOverview> {
  const [nodeCount, patternCount, episodeCount, experimentCount] = await Promise.all([
    prisma.knowledgeGraphNode.count(),
    prisma.learningPattern.count(),
    prisma.episodeMemory.count(),
    prisma.experiment.count(),
  ]);

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [nodeCountWeekAgo, nodeCountMonthAgo, patternCountWeekAgo, patternCountMonthAgo] =
    await Promise.all([
      prisma.knowledgeGraphNode.count({ where: { createdAt: { lte: weekAgo } } }),
      prisma.knowledgeGraphNode.count({ where: { createdAt: { lte: monthAgo } } }),
      prisma.learningPattern.count({ where: { createdAt: { lte: weekAgo } } }),
      prisma.learningPattern.count({ where: { createdAt: { lte: monthAgo } } }),
    ]);

  const totalMemoryNow = nodeCount + patternCount;
  const totalMemoryWeekAgo = nodeCountWeekAgo + patternCountWeekAgo;
  const totalMemoryMonthAgo = nodeCountMonthAgo + patternCountMonthAgo;

  const weeklyGrowth =
    totalMemoryWeekAgo > 0 ? ((totalMemoryNow - totalMemoryWeekAgo) / totalMemoryWeekAgo) * 100 : 0;
  const monthlyGrowth =
    totalMemoryMonthAgo > 0
      ? ((totalMemoryNow - totalMemoryMonthAgo) / totalMemoryMonthAgo) * 100
      : 0;

  const [completedExperiments, totalExperiments] = await Promise.all([
    prisma.experiment.count({ where: { status: 'completed' } }),
    prisma.experiment.count(),
  ]);
  const currentSuccessRate = totalExperiments > 0 ? completedExperiments / totalExperiments : 0;

  const { score: memoryScore, level: memoryLevel } = computeMemoryStrength(
    { nodes: nodeCount, patterns: patternCount, episodes: episodeCount },
    currentSuccessRate,
  );

  const [recentPatterns, recentNodes] = await Promise.all([
    prisma.learningPattern.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, description: true, confidence: true, createdAt: true },
    }),
    prisma.knowledgeGraphNode.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, label: true, nodeType: true, weight: true, createdAt: true },
    }),
  ]);

  const nodeDistribution = await prisma.knowledgeGraphNode.groupBy({
    by: ['nodeType'],
    _count: { nodeType: true },
  });

  const totalNodes = nodeDistribution.reduce((sum, item) => sum + item._count.nodeType, 0);
  const knowledgeDistribution = nodeDistribution.map((item) => ({
    category: item.nodeType,
    count: item._count.nodeType,
    percentage: totalNodes > 0 ? (item._count.nodeType / totalNodes) * 100 : 0,
  }));

  log.info(
    {
      totalMemory: totalMemoryNow,
      weeklyGrowth: weeklyGrowth.toFixed(1),
      monthlyGrowth: monthlyGrowth.toFixed(1),
      memoryScore,
      memoryLevel,
    },
    'Memory overview calculated',
  );

  return {
    totalMemorySize: {
      nodes: nodeCount,
      patterns: patternCount,
      episodes: episodeCount,
      experiments: experimentCount,
    },
    growthRate: { weekly: weeklyGrowth, monthly: monthlyGrowth },
    currentSuccessRate,
    memoryStrength: { score: memoryScore, level: memoryLevel },
    recentHighlights: {
      latestPatterns: recentPatterns.map((p) => ({
        id: p.id,
        description: p.description,
        confidence: p.confidence,
        createdAt: p.createdAt.toISOString(),
      })),
      latestNodes: recentNodes.map((n) => ({
        id: n.id,
        label: n.label,
        nodeType: n.nodeType,
        weight: n.weight,
        createdAt: n.createdAt.toISOString(),
      })),
    },
    knowledgeDistribution,
  };
}
