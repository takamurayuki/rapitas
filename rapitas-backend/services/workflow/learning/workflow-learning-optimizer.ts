/**
 * Workflow Learning Optimizer Service
 *
 * Accumulates and analyzes workflow execution data from completed tasks
 * to automatically optimize workflow modes for similar future tasks.
 * Delegates record keeping to workflow-learning-stats, rule detection to
 * workflow-learning-rules, and estimation to workflow-learning-estimator.
 */
import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';
import { analyzeTaskComplexity, type TaskComplexityInput } from '../complexity-analyzer';
import { matchesCondition, type RuleGenerationResult } from './workflow-learning-helpers';
import { estimateDurationFromHistory, getDirectInsight } from './workflow-learning-estimator';
import { runRuleDetection } from './workflow-learning-rules';
import { resolveTaskForLearning } from '../../task/task-resolver';

// Re-export sub-module symbols so existing imports from this path keep working.
export { recordWorkflowCompletion, getLearningStats } from './workflow-learning-stats';
export {
  calculatePhaseTimings,
  extractKeywords,
  detectSkippedPhases,
  matchesCondition,
} from './workflow-learning-helpers';
export type { PhaseTimings, RuleGenerationResult } from './workflow-learning-helpers';
export { estimateDurationFromHistory, getDirectInsight } from './workflow-learning-estimator';

const log = createLogger('workflow-learning');

// ───────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────

interface WorkflowRecommendation {
  taskId: number;
  currentMode: string;
  recommendedMode: string;
  skipPhases: string[];
  estimatedDuration: number;
  confidence: number;
  reasons: string[];
  matchedRules: Array<{
    ruleId: number;
    description: string;
    confidence: number;
  }>;
}

const CONFIDENCE_THRESHOLD = 0.6;

// ───────────────────────────────────────────────
// Automatic Optimization Rule Generation
// ───────────────────────────────────────────────

/**
 * Auto-generate and update optimization rules from accumulated learning data.
 *
 * @returns Summary of rules created, updated, and deactivated. / 作成・更新・非活性化されたルールのサマリー
 */
export async function generateOptimizationRules(): Promise<RuleGenerationResult> {
  const result: RuleGenerationResult = {
    rulesCreated: 0,
    rulesUpdated: 0,
    rulesDeactivated: 0,
    details: [],
  };

  try {
    const records = await prisma.workflowLearningRecord.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    await runRuleDetection(records, result);
  } catch (error) {
    log.error({ err: error }, 'Failed to generate optimization rules');
  }

  return result;
}

// ───────────────────────────────────────────────
// Rule application at mode-assignment time
// ───────────────────────────────────────────────

/** Result of applying learned mode rules to a base mode decision. */
export interface RuleModeDecision {
  mode: 'lightweight' | 'standard' | 'comprehensive';
  ruleIds: number[];
  reasons: string[];
}

/**
 * Apply active high-confidence MODE rules to a base mode decision.
 *
 * The nightly generateOptimizationRules cron has produced rules for months,
 * but their only consumer was the read-only learning panel — recommendations
 * were rendered, never applied. This is the application path, called when a
 * task's workflow mode is auto-assigned at creation. The human override is
 * structural: users change the mode any time via the task UI, and rules never
 * touch a task after creation.
 *
 * Only set_mode / downgrade_mode actions with confidence > 0.7 apply;
 * skip_phase / adjust_threshold stay advisory (panel-only) for now.
 *
 * @param task - Fields the rule conditions match on. / 条件マッチ用フィールド
 * @param complexityScore - The task's computed complexity score. / 複雑度スコア
 * @param baseMode - Mode recommended by the settings-based ranges. / 基準モード
 * @returns The (possibly rule-adjusted) mode plus applied rules. / 適用結果
 */
export async function applyModeRules(
  task: { themeId: number | null },
  complexityScore: number,
  baseMode: 'lightweight' | 'standard' | 'comprehensive',
): Promise<RuleModeDecision> {
  try {
    const rules = await prisma.workflowOptimizationRule.findMany({
      where: { isActive: true, confidence: { gte: CONFIDENCE_THRESHOLD } },
      orderBy: { confidence: 'desc' },
    });

    let mode = baseMode;
    const ruleIds: number[] = [];
    const reasons: string[] = [];

    for (const rule of rules) {
      const condition = JSON.parse(rule.condition) as Record<string, unknown>;
      const recommendation = JSON.parse(rule.recommendation) as {
        action?: string;
        targetMode?: 'lightweight' | 'standard' | 'comprehensive';
        reason?: string;
      };

      // `workflowMode: mode` — a rule conditioned on originalMode matches the
      // CURRENT decision, so a chain of rules evaluates against the running result.
      if (
        !matchesCondition(condition, { themeId: task.themeId, workflowMode: mode }, complexityScore)
      ) {
        continue;
      }
      if (
        (recommendation.action === 'set_mode' || recommendation.action === 'downgrade_mode') &&
        rule.confidence > 0.7 &&
        recommendation.targetMode
      ) {
        mode = recommendation.targetMode;
        ruleIds.push(rule.id);
        if (recommendation.reason) reasons.push(recommendation.reason);
      }
    }

    if (ruleIds.length > 0) {
      await prisma.workflowOptimizationRule.updateMany({
        where: { id: { in: ruleIds } },
        data: { lastEvaluated: new Date() },
      });
    }
    return { mode, ruleIds, reasons };
  } catch (err) {
    // Rule application must never block mode assignment.
    log.warn({ err }, 'applyModeRules failed; keeping base mode');
    return { mode: baseMode, ruleIds: [], reasons: [] };
  }
}

// ───────────────────────────────────────────────
// Task Optimization Recommendations
// ───────────────────────────────────────────────

/**
 * Propose workflow optimization for a new task.
 *
 * @param taskId - The task to produce a recommendation for. / 推奨を生成するタスクID
 * @returns Recommendation object, or null on error or missing task. / 推奨オブジェクト、エラーまたはタスク不在の場合null
 */
export async function getWorkflowRecommendation(
  taskId: number,
): Promise<WorkflowRecommendation | null> {
  try {
    const task = await resolveTaskForLearning(taskId);

    if (!task) return null;

    const complexityInput: TaskComplexityInput = {
      title: task.title,
      description: task.description,
      estimatedHours: task.estimatedHours,
      labels: task.taskLabels.map((tl) => tl.label.name),
      priority: task.priority,
      themeId: task.themeId,
    };
    const analysis = analyzeTaskComplexity(complexityInput);

    const rules = await prisma.workflowOptimizationRule.findMany({
      where: { isActive: true, confidence: { gte: CONFIDENCE_THRESHOLD } },
      orderBy: { confidence: 'desc' },
    });

    const matchedRules: WorkflowRecommendation['matchedRules'] = [];
    const reasons: string[] = [];
    let recommendedMode = analysis.recommendedMode;
    const skipPhases: string[] = [];

    for (const rule of rules) {
      const condition = JSON.parse(rule.condition);
      const recommendation = JSON.parse(rule.recommendation);

      if (matchesCondition(condition, task, analysis.complexityScore)) {
        matchedRules.push({
          ruleId: rule.id,
          description: rule.description,
          confidence: rule.confidence,
        });

        switch (recommendation.action) {
          case 'downgrade_mode':
          case 'set_mode':
            if (rule.confidence > 0.7) {
              recommendedMode = recommendation.targetMode;
              reasons.push(recommendation.reason);
            }
            break;
          case 'skip_phase':
            if (rule.confidence > 0.7) {
              skipPhases.push(recommendation.phase);
              reasons.push(recommendation.reason);
            }
            break;
          case 'adjust_threshold':
            reasons.push(recommendation.reason);
            break;
        }
      }
    }

    if (matchedRules.length > 0) {
      await prisma.workflowOptimizationRule.updateMany({
        where: { id: { in: matchedRules.map((r) => r.ruleId) } },
        data: { lastEvaluated: new Date() },
      });
    } else {
      // NOTE: Resolved before estimateDurationFromHistory below so the duration
      // estimate reflects the final recommended mode. Previously this ran AFTER
      // the estimate was computed, so a direct-insight override left the
      // returned estimatedDuration stale (computed for the pre-override mode).
      const directInsight = await getDirectInsight(task, analysis.complexityScore);
      if (directInsight) {
        recommendedMode = directInsight.mode as 'lightweight' | 'standard' | 'comprehensive';
        reasons.push(directInsight.reason);
      }
    }

    const estimatedDuration = await estimateDurationFromHistory(
      task.themeId,
      recommendedMode,
      analysis.complexityScore,
    );

    const confidence =
      matchedRules.length > 0
        ? matchedRules.reduce((sum, r) => sum + r.confidence, 0) / matchedRules.length
        : 0.5;

    return {
      taskId,
      currentMode: task.workflowMode || 'comprehensive',
      recommendedMode,
      skipPhases,
      estimatedDuration,
      confidence,
      reasons: reasons.length > 0 ? reasons : ['学習データに基づく標準推奨'],
      matchedRules,
    };
  } catch (error) {
    log.error({ err: error, taskId }, 'Failed to get workflow recommendation');
    return null;
  }
}
