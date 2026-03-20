/**
 * Learning Statistics Operations
 *
 * Aggregation and reporting functions: learning stats summary,
 * growth timeline over configurable periods, and memory overview.
 * Pattern and prompt evolution operations live in separate modules.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import type {
  LearningStats,
  GrowthTimeline,
  GrowthTimelineEntry,
  MemoryOverview,
} from './types';

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

/**
 * Calculates a day-by-day growth timeline for the specified period.
 *
 * @param period - Time window: '7d', '30d', or 'all' / 集計期間
 * @returns GrowthTimeline with per-day entries / 日次エントリを含むGrowthTimeline
 */
export async function getGrowthTimeline(
  period: '7d' | '30d' | 'all' = '30d',
): Promise<GrowthTimeline> {
  const now = new Date();
  let startDate: Date;

  switch (period) {
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case 'all': {
      const firstExperiment = await prisma.experiment.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      startDate = firstExperiment?.createdAt ?? now;
      break;
    }
  }

  const dates: string[] = [];
  const currentDate = new Date(startDate);
  while (currentDate <= now) {
    dates.push(currentDate.toISOString().split('T')[0]);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  const timeline: GrowthTimelineEntry[] = [];

  for (const date of dates) {
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    const [
      nodeCount,
      edgeCount,
      patternCount,
      completedExpCount,
      totalExpCount,
      avgConfidenceResult,
      promptCount,
    ] = await Promise.all([
      prisma.knowledgeGraphNode.count({ where: { createdAt: { lte: endOfDay } } }),
      prisma.knowledgeGraphEdge.count({ where: { createdAt: { lte: endOfDay } } }),
      prisma.learningPattern.count({ where: { createdAt: { lte: endOfDay } } }),
      prisma.experiment.count({
        where: { status: 'completed', completedAt: { lte: endOfDay } },
      }),
      prisma.experiment.count({ where: { createdAt: { lte: endOfDay } } }),
      prisma.experiment.aggregate({
        where: { status: 'completed', completedAt: { lte: endOfDay } },
        _avg: { confidence: true },
      }),
      prisma.promptEvolution.count({ where: { createdAt: { lte: endOfDay } } }),
    ]);

    timeline.push({
      date,
      knowledgeNodes: nodeCount,
      knowledgeEdges: edgeCount,
      learningPatterns: patternCount,
      experimentsCompleted: completedExpCount,
      successRate: totalExpCount > 0 ? completedExpCount / totalExpCount : 0,
      avgConfidence: avgConfidenceResult._avg?.confidence ?? 0,
      promptImprovements: promptCount,
    });
  }

  log.info({ period, totalDays: dates.length }, 'Growth timeline calculated');

  return {
    timeline,
    period,
    totalDays: dates.length,
  };
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

  const memoryScore = Math.min(
    100,
    Math.floor(
      nodeCount * 0.3 +
        patternCount * 0.4 +
        currentSuccessRate * 30 +
        Math.min(1, episodeCount / 100) * 10,
    ),
  );

  let memoryLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  if (memoryScore < 25) memoryLevel = 'beginner';
  else if (memoryScore < 50) memoryLevel = 'intermediate';
  else if (memoryScore < 75) memoryLevel = 'advanced';
  else memoryLevel = 'expert';

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
