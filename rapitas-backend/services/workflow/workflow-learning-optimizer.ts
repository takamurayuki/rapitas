/**
 * Workflow Learning Optimizer Service
 *
 * Accumulates and analyzes workflow execution data from completed tasks
 * to automatically optimize workflow modes for similar future tasks.
 * Delegates record keeping to workflow-learning-stats, rule detection to
 * workflow-learning-rules, and estimation to workflow-learning-estimator.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { analyzeTaskComplexity, type TaskComplexityInput } from './complexity-analyzer';
import { matchesCondition, type RuleGenerationResult } from './workflow-learning-helpers';
import { estimateDurationFromHistory, getDirectInsight } from './workflow-learning-estimator';
import { runRuleDetection } from './workflow-learning-rules';

// Re-export sub-module symbols so existing imports from this path keep working.
export { recordWorkflowCompletion, getLearningStats } from './workflow-learning-stats';
export { calculatePhaseTimings, extractKeywords, detectSkippedPhases, matchesCondition } from './workflow-learning-helpers';
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
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        theme: { include: { category: true } },
        taskLabels: { include: { label: true } },
      },
    });

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

    const estimatedDuration = await estimateDurationFromHistory(
      task.themeId,
      recommendedMode,
      analysis.complexityScore,
    );

    if (matchedRules.length > 0) {
      await prisma.workflowOptimizationRule.updateMany({
        where: { id: { in: matchedRules.map((r) => r.ruleId) } },
        data: { lastEvaluated: new Date() },
      });
    }

    if (matchedRules.length === 0) {
      const directInsight = await getDirectInsight(task, analysis.complexityScore);
      if (directInsight) {
        recommendedMode = directInsight.mode as 'lightweight' | 'standard' | 'comprehensive';
        reasons.push(directInsight.reason);
      }
    }

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
