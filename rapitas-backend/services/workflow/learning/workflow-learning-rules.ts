/**
 * Workflow Learning Rules
 *
 * Analyses accumulated learning records to automatically generate and update
 * WorkflowOptimizationRule entries. Four detection strategies are implemented:
 * mode-downgrade patterns, phase-skip patterns, per-theme optimal mode
 * detection, and complexity-threshold adjustment.
 */
import { createLogger } from '../../../config/logger';
import {
  upsertRule,
  deactivateStaleRules,
  type RuleGenerationResult,
} from './workflow-learning-helpers';

const log = createLogger('workflow-learning-rules');

const MIN_SAMPLES_FOR_RULE = 5;
const HIGH_SUCCESS_THRESHOLD = 0.85;

/** Subset of WorkflowLearningRecord fields required by the detection strategies. */
type LearningRecord = {
  workflowMode: string;
  actualDurationMinutes: number | null;
  estimatedDuration: number | null;
  outcome: string;
  success: boolean;
  predictedComplexity: number | null;
  themeId: number | null;
  categoryId: number | null;
  titleKeywords: string;
  wasOverridden: boolean;
  overriddenFrom: string | null;
  phaseTimings: string;
  skippedPhases: string;
};

// ───────────────────────────────────────────────
// Rule Generation Entry Point
// ───────────────────────────────────────────────

/**
 * Run all four detection strategies against the provided learning records.
 *
 * @param records - Recent learning records to analyse (caller provides slice). / 分析する最近の学習レコード
 * @param result - Mutable result object to accumulate counts and details. / カウントと詳細を集積する可変結果オブジェクト
 */
export async function runRuleDetection(
  records: LearningRecord[],
  result: RuleGenerationResult,
): Promise<void> {
  if (records.length < MIN_SAMPLES_FOR_RULE) {
    result.details.push(`サンプル不足: ${records.length}/${MIN_SAMPLES_FOR_RULE}件`);
    return;
  }

  await detectModeDowngradePatterns(records, result);
  await detectPhaseSkipPatterns(records, result);
  await detectThemeOptimalMode(records, result);
  await detectComplexityThresholdAdjustment(records, result);
  await deactivateStaleRules(result);

  log.info(result, 'Optimization rules generation completed');
}

// ───────────────────────────────────────────────
// Detection Strategies
// ───────────────────────────────────────────────

/** Detect cases where comprehensive mode was used but a lighter mode was sufficient. */
async function detectModeDowngradePatterns(
  records: LearningRecord[],
  result: RuleGenerationResult,
): Promise<void> {
  const downgraded = records.filter((r) => r.wasOverridden && r.overriddenFrom && r.success);
  if (downgraded.length < MIN_SAMPLES_FOR_RULE) return;

  const allOverridden = records.filter((r) => r.wasOverridden && r.overriddenFrom);
  const successRate = downgraded.length / Math.max(1, allOverridden.length);

  if (successRate >= HIGH_SUCCESS_THRESHOLD) {
    const complexities = downgraded.map((r) => r.predictedComplexity).filter((c): c is number => c !== null);
    if (complexities.length === 0) return;

    const avgComplexity = complexities.reduce((a, b) => a + b, 0) / complexities.length;
    const maxComplexity = Math.max(...complexities);

    const condition = JSON.stringify({ predictedComplexityBelow: Math.round(maxComplexity + 5), originalMode: 'comprehensive' });
    const recommendation = JSON.stringify({
      action: 'downgrade_mode',
      targetMode: 'standard',
      reason: `複雑度${Math.round(avgComplexity)}以下のタスクでcomprehensiveモード不要（成功率${Math.round(successRate * 100)}%）`,
    });

    await upsertRule(
      'downgrade_mode', condition, recommendation, successRate, allOverridden.length,
      `複雑度${Math.round(maxComplexity)}以下ではstandardモードで十分（${downgraded.length}件の実績）`,
      result,
    );
  }
}

/** Detect patterns where specific phases are effectively skipped and tasks still succeed. */
async function detectPhaseSkipPatterns(
  records: LearningRecord[],
  result: RuleGenerationResult,
): Promise<void> {
  const phases = ['research', 'plan'] as const;

  for (const phase of phases) {
    const hasPhase = (r: LearningRecord) => {
      try { return (JSON.parse(r.skippedPhases) as string[]).includes(phase); } catch { return false; }
    };

    const skipped = records.filter((r) => hasPhase(r) && r.success);
    if (skipped.length < MIN_SAMPLES_FOR_RULE) continue;

    const allWithSkip = records.filter(hasPhase);
    const successRate = skipped.length / Math.max(1, allWithSkip.length);

    if (successRate >= HIGH_SUCCESS_THRESHOLD) {
      const complexities = skipped.map((r) => r.predictedComplexity).filter((c): c is number => c !== null);
      const maxComplexity = complexities.length > 0 ? Math.max(...complexities) : 35;

      const condition = JSON.stringify({ predictedComplexityBelow: Math.round(maxComplexity), phase });
      const recommendation = JSON.stringify({
        action: 'skip_phase', phase,
        reason: `複雑度${Math.round(maxComplexity)}以下では${phase}フェーズ不要（成功率${Math.round(successRate * 100)}%）`,
      });

      await upsertRule(
        'skip_phase', condition, recommendation, successRate, allWithSkip.length,
        `${phase}フェーズスキップ推奨: 複雑度${Math.round(maxComplexity)}以下（${skipped.length}件の実績）`,
        result,
      );
    }
  }
}

/** Detect the optimal workflow mode per theme based on success rate and duration. */
async function detectThemeOptimalMode(
  records: LearningRecord[],
  result: RuleGenerationResult,
): Promise<void> {
  const byTheme = new Map<number, LearningRecord[]>();
  for (const r of records) {
    if (r.themeId === null) continue;
    const group = byTheme.get(r.themeId) ?? [];
    group.push(r);
    byTheme.set(r.themeId, group);
  }

  for (const [themeId, themeRecords] of byTheme) {
    if (themeRecords.length < MIN_SAMPLES_FOR_RULE) continue;

    const modeStats = new Map<string, { total: number; success: number; durations: number[] }>();
    for (const r of themeRecords) {
      const stats = modeStats.get(r.workflowMode) ?? { total: 0, success: 0, durations: [] };
      stats.total++;
      if (r.success) stats.success++;
      if (r.actualDurationMinutes) stats.durations.push(r.actualDurationMinutes);
      modeStats.set(r.workflowMode, stats);
    }

    let bestMode: string | null = null;
    let bestScore = -1;

    for (const [mode, stats] of modeStats) {
      if (stats.total < 3) continue;
      const successRate = stats.success / stats.total;
      if (successRate < HIGH_SUCCESS_THRESHOLD) continue;
      const avgDuration = stats.durations.length > 0 ? stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length : Infinity;
      // Score = success rate * (1 / normalized duration)
      const score = successRate * (1000 / Math.max(1, avgDuration));
      if (score > bestScore) { bestScore = score; bestMode = mode; }
    }

    if (!bestMode) continue;
    const mostUsedMode = [...modeStats.entries()].sort((a, b) => b[1].total - a[1].total)[0]?.[0];
    if (bestMode === mostUsedMode) continue;

    const bestStats = modeStats.get(bestMode)!;
    const successRate = bestStats.success / bestStats.total;
    const condition = JSON.stringify({ themeId });
    const recommendation = JSON.stringify({
      action: 'set_mode', targetMode: bestMode,
      reason: `テーマ${themeId}では${bestMode}モードが最適（成功率${Math.round(successRate * 100)}%）`,
    });

    await upsertRule(
      'adjust_time', condition, recommendation, successRate, themeRecords.length,
      `テーマ${themeId}: ${bestMode}モード推奨（${bestStats.total}件で成功率${Math.round(successRate * 100)}%）`,
      result,
    );
  }
}

/** Detect cases where the complexity score threshold is misaligned with actual outcomes. */
async function detectComplexityThresholdAdjustment(
  records: LearningRecord[],
  result: RuleGenerationResult,
): Promise<void> {
  const lightweightFailed = records.filter(
    (r) => r.workflowMode === 'lightweight' && !r.success && !r.wasOverridden && r.predictedComplexity !== null,
  );

  if (lightweightFailed.length < 3) return;

  const complexities = lightweightFailed.map((r) => r.predictedComplexity!).sort((a, b) => a - b);
  const medianComplexity = complexities[Math.floor(complexities.length / 2)];

  // NOTE: 35 is the current lightweight upper threshold defined in complexity-analyzer.ts.
  if (medianComplexity <= 35) {
    const newThreshold = Math.max(15, Math.round(medianComplexity - 5));
    const condition = JSON.stringify({ currentThreshold: 35, failureComplexityMedian: medianComplexity });
    const recommendation = JSON.stringify({
      action: 'adjust_threshold', lightweightMax: newThreshold,
      reason: `lightweight失敗が複雑度${Math.round(medianComplexity)}付近で多発（${lightweightFailed.length}件）`,
    });

    await upsertRule(
      'upgrade_mode', condition, recommendation, 0.7, lightweightFailed.length,
      `lightweight閾値を${newThreshold}に引き下げ推奨（${lightweightFailed.length}件の失敗）`,
      result,
    );
  }
}
