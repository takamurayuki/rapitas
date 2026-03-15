/**
 * Learning Engine -
 *
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import type {
  CreatePatternInput,
  CreatePromptEvolutionInput,
  LearningStats,
  LearningPatternType,
  LearningCategory,
  GrowthTimeline,
  GrowthTimelineEntry,
  MemoryOverview,
} from './types';

const log = createLogger('self-learning:learning');

/**
 */
export async function analyzeFailure(experimentId: number): Promise<string[]> {
  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
  });

  if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

  const evaluation = experiment.evaluation ? JSON.parse(experiment.evaluation) : null;

  const failureReasons: string[] = [];

  if (evaluation) {
    if (evaluation.testsFailed > 0) {
      failureReasons.push(`${evaluation.testsFailed} tests failed`);
    }
    if (evaluation.errorsEncountered?.length > 0) {
      failureReasons.push(`Errors: ${evaluation.errorsEncountered.join(', ')}`);
    }
    if (!evaluation.overallSuccess) {
      failureReasons.push('Overall evaluation marked as unsuccessful');
    }
  }

  const similarPatterns = await prisma.learningPattern.findMany({
    where: { patternType: 'failure_pattern' },
    orderBy: { occurrences: 'desc' },
    take: 5,
  });

  for (const pattern of similarPatterns) {
    const conditions = JSON.parse(pattern.conditions);
    const matchesAny = conditions.some((c: { value: string }) =>
      failureReasons.some((r) => r.toLowerCase().includes(c.value.toLowerCase())),
    );
    if (matchesAny) {
      await prisma.learningPattern.update({
        where: { id: pattern.id },
        data: {
          occurrences: pattern.occurrences + 1,
          lastObserved: new Date(),
        },
      });
      failureReasons.push(`Matches known pattern: ${pattern.description}`);
    }
  }

  log.info({ experimentId, reasons: failureReasons.length }, 'Failure analysis completed');
  return failureReasons;
}

/**
 */
export async function extractStrategy(experimentId: number): Promise<string[]> {
  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
  });

  if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

  const strategies: string[] = [];

  const validatedHypotheses = await prisma.hypothesis.findMany({
    where: { experimentId, status: 'validated' },
  });
  for (const h of validatedHypotheses) {
    strategies.push(`Validated approach: ${h.content}`);
  }

  // Critic
  const goodReviews = await prisma.criticReview.findMany({
    where: { experimentId, overallScore: { gte: 0.7 } },
  });
  for (const r of goodReviews) {
    strategies.push(`High-quality ${r.phase}: ${r.feedback.slice(0, 100)}`);
  }

  if (strategies.length > 0 && experiment.status === 'completed') {
    await createPattern({
      patternType: 'success_strategy',
      category: 'feature_implementation',
      description: `Success strategy from experiment "${experiment.title}"`,
      conditions: [
        {
          field: 'task_type',
          operator: 'contains',
          value: experiment.title.split(' ')[0] ?? '',
        },
      ],
      actions: strategies.map((s) => ({
        type: 'suggest_approach' as const,
        description: s,
      })),
      confidence: experiment.confidence,
    });
  }

  log.info({ experimentId, strategies: strategies.length }, 'Strategy extraction completed');
  return strategies;
}

/**
 * /
 */
export async function createPattern(input: CreatePatternInput) {
  return prisma.learningPattern.create({
    data: {
      patternType: input.patternType,
      category: input.category,
      description: input.description,
      conditions: JSON.stringify(input.conditions ?? []),
      actions: JSON.stringify(input.actions ?? []),
      confidence: input.confidence ?? 0.5,
    },
  });
}

/**
 */
export async function listPatterns(
  options: {
    patternType?: LearningPatternType;
    category?: LearningCategory;
    page?: number;
    limit?: number;
  } = {},
) {
  const { patternType, category, page = 1, limit = 20 } = options;

  const where: Record<string, unknown> = {};
  if (patternType) where.patternType = patternType;
  if (category) where.category = category;

  const [patterns, total] = await Promise.all([
    prisma.learningPattern.findMany({
      where,
      orderBy: [{ occurrences: 'desc' }, { confidence: 'desc' }],
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.learningPattern.count({ where }),
  ]);

  return {
    patterns: (
      patterns as Array<{
        conditions: string;
        actions: string;
        metadata: string;
        [key: string]: unknown;
      }>
    ).map((p) => ({
      ...p,
      conditions: JSON.parse(p.conditions),
      actions: JSON.parse(p.actions),
      metadata: JSON.parse(p.metadata),
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 */
export async function recordPromptEvolution(input: CreatePromptEvolutionInput) {
  return prisma.promptEvolution.create({
    data: {
      experimentId: input.experimentId,
      category: input.category,
      beforePrompt: input.beforePrompt,
      afterPrompt: input.afterPrompt,
      improvement: input.improvement,
      performanceDelta: input.performanceDelta ?? 0,
    },
  });
}

/**
 */
export async function getPromptEvolutionHistory(category?: string) {
  const where: Record<string, unknown> = {};
  if (category) where.category = category;

  return prisma.promptEvolution.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

/**
 * Statistics
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
    case 'all':
      const firstExperiment = await prisma.experiment.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      startDate = firstExperiment?.createdAt ?? now;
      break;
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
      prisma.knowledgeGraphNode.count({
        where: { createdAt: { lte: endOfDay } },
      }),
      prisma.knowledgeGraphEdge.count({
        where: { createdAt: { lte: endOfDay } },
      }),
      prisma.learningPattern.count({
        where: { createdAt: { lte: endOfDay } },
      }),
      prisma.experiment.count({
        where: {
          status: 'completed',
          completedAt: { lte: endOfDay },
        },
      }),
      prisma.experiment.count({
        where: { createdAt: { lte: endOfDay } },
      }),
      prisma.experiment.aggregate({
        where: {
          status: 'completed',
          completedAt: { lte: endOfDay },
        },
        _avg: { confidence: true },
      }),
      prisma.promptEvolution.count({
        where: { createdAt: { lte: endOfDay } },
      }),
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
 */
export async function getMemoryOverview(): Promise<MemoryOverview> {
  const [nodeCount, patternCount, episodeCount, experimentCount] = await Promise.all([
    prisma.knowledgeGraphNode.count(),
    prisma.learningPattern.count(),
    prisma.episodeMemory.count(),
    prisma.experiment.count(),
  ]);

  // 11（）
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [nodeCountWeekAgo, nodeCountMonthAgo, patternCountWeekAgo, patternCountMonthAgo] =
    await Promise.all([
      prisma.knowledgeGraphNode.count({
        where: { createdAt: { lte: weekAgo } },
      }),
      prisma.knowledgeGraphNode.count({
        where: { createdAt: { lte: monthAgo } },
      }),
      prisma.learningPattern.count({
        where: { createdAt: { lte: weekAgo } },
      }),
      prisma.learningPattern.count({
        where: { createdAt: { lte: monthAgo } },
      }),
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
      select: {
        id: true,
        description: true,
        confidence: true,
        createdAt: true,
      },
    }),
    prisma.knowledgeGraphNode.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        label: true,
        nodeType: true,
        weight: true,
        createdAt: true,
      },
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
    growthRate: {
      weekly: weeklyGrowth,
      monthly: monthlyGrowth,
    },
    currentSuccessRate,
    memoryStrength: {
      score: memoryScore,
      level: memoryLevel,
    },
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
