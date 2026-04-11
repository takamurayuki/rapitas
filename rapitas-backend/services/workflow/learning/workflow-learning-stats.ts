/**
 * Workflow Learning Stats
 *
 * Provides `recordWorkflowCompletion` (persists one learning record on task
 * completion) and `getLearningStats` (aggregates recent records for display).
 * Both functions are read/write against the database only; no agent execution.
 */
import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';
import { analyzeTaskComplexity, type TaskComplexityInput } from '../complexity-analyzer';
import {
  calculatePhaseTimings,
  extractKeywords,
  detectSkippedPhases,
} from './workflow-learning-helpers';

const log = createLogger('workflow-learning-stats');

interface LearningStats {
  totalRecords: number;
  byMode: Record<string, { count: number; avgDuration: number; successRate: number }>;
  byOutcome: Record<string, number>;
  overrideRate: number;
  avgAccuracy: number;
  recentTrend: {
    period: string;
    modeDistribution: Record<string, number>;
  };
}

/**
 * Record workflow execution data on task completion.
 *
 * @param taskId - ID of the completed task. / 完了したタスクのID
 */
export async function recordWorkflowCompletion(taskId: number): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        theme: { include: { category: true } },
        taskLabels: { include: { label: true } },
        activityLogs: {
          where: {
            action: {
              in: [
                'workflow_status_updated',
                'plan_approved',
                'plan_auto_approved',
                'plan_rejected',
                'workflow_mode_changed',
              ],
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!task) {
      log.warn({ taskId }, 'Task not found for workflow learning record');
      return;
    }

    const phaseTimings = calculatePhaseTimings(task.activityLogs, task.createdAt);

    const actualDuration = task.completedAt
      ? Math.round((task.completedAt.getTime() - task.createdAt.getTime()) / 60000)
      : null;

    const titleKeywords = extractKeywords(task.title);

    const complexityInput: TaskComplexityInput = {
      title: task.title,
      description: task.description,
      estimatedHours: task.estimatedHours,
      labels: task.taskLabels.map((tl) => tl.label.name),
      priority: task.priority,
      themeId: task.themeId,
    };
    const analysis = analyzeTaskComplexity(complexityInput);

    const modeChangeLog = task.activityLogs.find((l) => l.action === 'workflow_mode_changed');
    let overriddenFrom: string | null = null;
    if (modeChangeLog && modeChangeLog.metadata) {
      try {
        const meta = JSON.parse(modeChangeLog.metadata);
        overriddenFrom = meta.previousMode || null;
      } catch {
        // ignore
      }
    }

    const skippedPhases = detectSkippedPhases(
      task.workflowMode || 'comprehensive',
      task.activityLogs,
    );

    await prisma.workflowLearningRecord.create({
      data: {
        taskId,
        workflowMode: task.workflowMode || 'comprehensive',
        predictedComplexity: task.complexityScore ?? analysis.complexityScore,
        actualDurationMinutes: actualDuration,
        estimatedDuration: analysis.estimatedExecutionTime,
        skippedPhases: JSON.stringify(skippedPhases),
        phaseTimings: JSON.stringify(phaseTimings),
        outcome: task.status === 'done' ? 'completed' : 'cancelled',
        wasOverridden: task.workflowModeOverride,
        overriddenFrom,
        categoryId: task.theme?.categoryId ?? null,
        themeId: task.themeId,
        labels: JSON.stringify(task.taskLabels.map((tl) => tl.label.name)),
        titleKeywords: JSON.stringify(titleKeywords),
        complexityFactors: JSON.stringify(analysis.analysisBreakdown),
        success: task.status === 'done',
      },
    });

    log.info(
      { taskId, mode: task.workflowMode, duration: actualDuration },
      'Workflow learning record created',
    );
  } catch (error) {
    log.error({ err: error, taskId }, 'Failed to record workflow completion');
  }
}

/**
 * Retrieve workflow learning statistics.
 *
 * @returns Aggregated stats across the most recent 200 learning records. / 最新200件の学習レコードの集計統計
 */
export async function getLearningStats(): Promise<LearningStats> {
  const records = await prisma.workflowLearningRecord.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const byMode: LearningStats['byMode'] = {};
  const byOutcome: Record<string, number> = {};
  let overrideCount = 0;
  let accuracySum = 0;
  let accuracyCount = 0;

  for (const r of records) {
    if (!byMode[r.workflowMode]) {
      byMode[r.workflowMode] = { count: 0, avgDuration: 0, successRate: 0 };
    }
    const modeStats = byMode[r.workflowMode];
    modeStats.count++;
    if (r.actualDurationMinutes) modeStats.avgDuration += r.actualDurationMinutes;
    if (r.success) modeStats.successRate++;

    byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1;
    if (r.wasOverridden) overrideCount++;

    if (r.actualDurationMinutes && r.estimatedDuration) {
      const ratio =
        Math.min(r.actualDurationMinutes, r.estimatedDuration) /
        Math.max(r.actualDurationMinutes, r.estimatedDuration);
      accuracySum += ratio;
      accuracyCount++;
    }
  }

  for (const mode of Object.keys(byMode)) {
    const stats = byMode[mode];
    if (stats.count > 0) {
      stats.avgDuration = Math.round(stats.avgDuration / stats.count);
      stats.successRate = Math.round((stats.successRate / stats.count) * 100) / 100;
    }
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentRecords = records.filter((r) => r.createdAt >= thirtyDaysAgo);
  const modeDistribution: Record<string, number> = {};
  for (const r of recentRecords) {
    modeDistribution[r.workflowMode] = (modeDistribution[r.workflowMode] || 0) + 1;
  }

  return {
    totalRecords: records.length,
    byMode,
    byOutcome,
    overrideRate: records.length > 0 ? Math.round((overrideCount / records.length) * 100) / 100 : 0,
    avgAccuracy: accuracyCount > 0 ? Math.round((accuracySum / accuracyCount) * 100) / 100 : 0,
    recentTrend: { period: '30d', modeDistribution },
  };
}
