/**
 * Workflow Learning Estimator
 *
 * Estimates task execution duration and provides direct insights from the
 * learning record history when no optimisation rules have matched.
 * All logic is read-only against the database.
 */
import { prisma } from '../../config';

/**
 * Estimate the expected duration (in minutes) for a task using historical data.
 *
 * Records are weighted by how close their predicted complexity is to the
 * current task's score; closer records contribute more to the average.
 *
 * @param themeId - Theme ID to narrow the search (null = cross-theme). / 検索を絞り込むテーマID（null = 全テーマ）
 * @param mode - Workflow mode string (e.g. "standard"). / ワークフローモード文字列
 * @param complexityScore - Current task complexity score. / 現在のタスク複雑度スコア
 * @returns Estimated duration in minutes. / 推定所要時間（分）
 */
export async function estimateDurationFromHistory(
  themeId: number | null,
  mode: string,
  complexityScore: number,
): Promise<number> {
  const where: Record<string, unknown> = {
    workflowMode: mode,
    success: true,
    actualDurationMinutes: { not: null },
  };

  if (themeId) {
    where.themeId = themeId;
  }

  const records = await prisma.workflowLearningRecord.findMany({
    where,
    select: { actualDurationMinutes: true, predictedComplexity: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  if (records.length === 0) {
    // Default fallback values when no history exists
    const defaults: Record<string, number> = { lightweight: 20, standard: 90, comprehensive: 210 };
    return defaults[mode] || 90;
  }

  // Weight records by proximity of complexity score
  let weightedSum = 0;
  let weightSum = 0;

  for (const r of records) {
    if (!r.actualDurationMinutes) continue;
    const diff = r.predictedComplexity ? Math.abs(complexityScore - r.predictedComplexity) : 50;
    // NOTE: Weight decays as 1/(1 + diff/20) so a 20-point difference halves the weight.
    const weight = 1 / (1 + diff / 20);
    weightedSum += r.actualDurationMinutes * weight;
    weightSum += weight;
  }

  return weightSum > 0 ? Math.round(weightedSum / weightSum) : 90;
}

/**
 * Derive a mode recommendation directly from the learning record history,
 * bypassing the rules engine. Used as a fallback when no rules match.
 *
 * @param task - Task fields used to filter history. / 履歴フィルタリングに使用するタスクフィールド
 * @param complexityScore - Current task complexity score. / 現在のタスク複雑度スコア
 * @returns Mode recommendation with reason, or null if insufficient data. / 理由付きモード推奨またはnull
 */
export async function getDirectInsight(
  task: { themeId: number | null; workflowMode: string | null },
  complexityScore: number,
): Promise<{ mode: string; reason: string } | null> {
  if (!task.themeId) return null;

  const themeRecords = await prisma.workflowLearningRecord.findMany({
    where: { themeId: task.themeId, success: true },
    select: { workflowMode: true, predictedComplexity: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  if (themeRecords.length < 3) return null;

  // Most-used mode among tasks with similar complexity (within ±15 points)
  const similar = themeRecords.filter(
    (r) => r.predictedComplexity && Math.abs(r.predictedComplexity - complexityScore) < 15,
  );

  if (similar.length < 3) return null;

  const modeCount: Record<string, number> = {};
  for (const r of similar) {
    modeCount[r.workflowMode] = (modeCount[r.workflowMode] || 0) + 1;
  }

  const bestMode = Object.entries(modeCount).sort((a, b) => b[1] - a[1])[0];

  if (bestMode && bestMode[0] !== task.workflowMode) {
    return {
      mode: bestMode[0],
      reason: `同テーマの類似タスク${similar.length}件中${bestMode[1]}件が${bestMode[0]}モードで成功`,
    };
  }

  return null;
}
