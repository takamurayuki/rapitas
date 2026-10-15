/**
 * mode-prediction
 *
 * Snapshots the workflow-mode prediction at the moment research fixes the
 * complexity score, and reads it back when the outcome is known. Owns only the
 * prediction half of the ledger — the outcome half stays with the
 * `WorkflowLearningRecord` writers.
 *
 * Why a snapshot rather than re-reading the task at outcome time: the estimated
 * duration is derived from the history as it stood WHEN the prediction was made,
 * and the mode can be overridden afterwards. Reconstructing either later would
 * silently rewrite what was actually predicted, which is exactly the failure the
 * decision ledger exists to prevent.
 */

import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import type { WorkflowMode } from '../workflow-types';

const log = createLogger('mode-prediction');

/** `ActivityLog.action` value carrying a mode prediction snapshot. */
export const MODE_PREDICTION_ACTION = 'workflow_mode_predicted';

/** One prediction made at research completion. */
export interface ModePrediction {
  /** 0-100 complexity the research agent assessed from the real code. */
  predictedComplexity: number;
  /** Mode selected from that score (or the pinned mode when overridden). */
  workflowMode: WorkflowMode;
  /** Expected duration in minutes from history at prediction time, null when unavailable. */
  estimatedDurationMinutes: number | null;
  /** Threshold band that produced the mode — what makes 35/70/85 falsifiable. */
  thresholds: { min: number; max: number };
  /** True when a user-pinned mode overrode the score-selected one. */
  wasOverridden: boolean;
}

/**
 * Persist a prediction snapshot. Fail-open: a bookkeeping error must never
 * break the research phase that produced the prediction.
 *
 * @param taskId - Task the prediction is about. / 対象タスクID
 * @param prediction - What was predicted, at the moment it was predicted. / 予測内容
 */
export async function recordModePrediction(
  taskId: number,
  prediction: ModePrediction,
): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        taskId,
        action: MODE_PREDICTION_ACTION,
        metadata: JSON.stringify(prediction),
      },
    });
    log.info({ taskId, ...prediction }, '[mode-prediction] recorded prediction snapshot');
  } catch (err) {
    log.warn({ err, taskId }, '[mode-prediction] failed to record prediction (non-fatal)');
  }
}

/**
 * Read the most recent prediction snapshot for a task.
 *
 * Research can re-run, so every snapshot is kept and the latest one wins — it is
 * the prediction the run that actually executed was made under.
 *
 * @param taskId - Task to look up. / 対象タスクID
 * @returns The latest prediction, or null when none was recorded. / 最新の予測、無ければnull
 */
export async function readModePrediction(taskId: number): Promise<ModePrediction | null> {
  try {
    const row = await prisma.activityLog.findFirst({
      where: { taskId, action: MODE_PREDICTION_ACTION },
      orderBy: { id: 'desc' },
      select: { metadata: true },
    });
    if (!row?.metadata) return null;
    const parsed: unknown = JSON.parse(row.metadata);
    if (!parsed || typeof parsed !== 'object') return null;
    const p = parsed as Partial<ModePrediction>;
    if (typeof p.predictedComplexity !== 'number' || typeof p.workflowMode !== 'string') {
      return null;
    }
    return {
      predictedComplexity: p.predictedComplexity,
      workflowMode: p.workflowMode as WorkflowMode,
      estimatedDurationMinutes:
        typeof p.estimatedDurationMinutes === 'number' ? p.estimatedDurationMinutes : null,
      thresholds:
        p.thresholds && typeof p.thresholds.min === 'number' && typeof p.thresholds.max === 'number'
          ? p.thresholds
          : { min: 0, max: 100 },
      wasOverridden: p.wasOverridden === true,
    };
  } catch (err) {
    log.warn({ err, taskId }, '[mode-prediction] failed to read prediction (non-fatal)');
    return null;
  }
}
