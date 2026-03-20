/**
 * Complexity Analyzer — Learning Integration
 *
 * Extends the base complexity analysis with historical workflow records from the
 * database to improve mode recommendations. Falls back to the base result on DB errors.
 */

import type { TaskComplexityInput, ComplexityAnalysisResult, LearningInsight } from './types';
import { analyzeTaskComplexity } from './core';

/**
 * Complexity analysis with learning data (extended version).
 *
 * In addition to standard analyzeTaskComplexity, reflects historical learning records
 * from similar tasks to return an optimized recommended mode.
 *
 * @param input - Task complexity input data / タスク複雑度の入力データ
 * @returns Full complexity result, optionally enriched with learning insight / 学習インサイト付き複雑度分析結果
 */
export async function analyzeTaskComplexityWithLearning(
  input: TaskComplexityInput,
): Promise<ComplexityAnalysisResult & { learningInsight?: LearningInsight }> {
  const baseResult = analyzeTaskComplexity(input);

  try {
    // Dynamic import to avoid circular dependency with Prisma
    const { prisma } = await import('../../../config');

    // Fetch learning records for the same theme
    const where: Record<string, unknown> = { success: true };
    if (input.themeId) where.themeId = input.themeId;

    const records = await prisma.workflowLearningRecord.findMany({
      where,
      select: {
        workflowMode: true,
        predictedComplexity: true,
        actualDurationMinutes: true,
        estimatedDuration: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    if (records.length < 3) {
      return baseResult;
    }

    // Extract tasks with similar complexity (within +/-15 points)
    const similar = records.filter(
      (r) =>
        r.predictedComplexity !== null &&
        Math.abs(r.predictedComplexity - baseResult.complexityScore) < 15,
    );

    if (similar.length < 3) {
      return baseResult;
    }

    // Determine the mode with highest success rate
    const modeCount: Record<string, number> = {};
    for (const r of similar) {
      modeCount[r.workflowMode] = (modeCount[r.workflowMode] || 0) + 1;
    }

    const sortedModes = Object.entries(modeCount).sort((a, b) => b[1] - a[1]);
    const topMode = sortedModes[0];

    // If sufficient data recommends a different mode than base analysis
    const learningRecommendedMode = topMode[0] as 'lightweight' | 'standard' | 'comprehensive';
    const learningConfidence = topMode[1] / similar.length;

    // Estimated time based on historical data
    const durations = similar
      .map((r) => r.actualDurationMinutes)
      .filter((d): d is number => d !== null);
    const avgActualDuration =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : baseResult.estimatedExecutionTime;

    const insight: LearningInsight = {
      sampleSize: similar.length,
      recommendedMode: learningRecommendedMode,
      confidence: Math.round(learningConfidence * 100) / 100,
      avgActualDuration,
      modeDistribution: modeCount,
      differs: learningRecommendedMode !== baseResult.recommendedMode,
    };

    // Override mode if learning data confidence is high
    if (insight.differs && learningConfidence >= 0.7 && similar.length >= 5) {
      return {
        ...baseResult,
        recommendedMode: learningRecommendedMode,
        estimatedExecutionTime: avgActualDuration,
        analysisBreakdown: {
          ...baseResult.analysisBreakdown,
          reasons: [
            ...baseResult.analysisBreakdown.reasons,
            `学習データ: 類似${similar.length}件中${topMode[1]}件が${learningRecommendedMode}で成功`,
          ],
        },
        learningInsight: insight,
      };
    }

    return { ...baseResult, learningInsight: insight };
  } catch {
    // On DB connection failure, return base result as-is
    return baseResult;
  }
}
