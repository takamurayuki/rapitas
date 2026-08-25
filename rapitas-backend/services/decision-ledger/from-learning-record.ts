/**
 * decision-ledger/from-learning-record
 *
 * Projects `WorkflowLearningRecord` rows into the shared `Decision` shape, and
 * is the only place that decides whether a complexity/mode prediction was borne
 * out. The table stores prediction and outcome but has never carried a verdict
 * column, so the judgement is derived here rather than stored.
 */

import type { Decision, DecisionVerdict } from './types';

/** The `WorkflowLearningRecord` columns this projection reads. */
export interface LearningRecordRow {
  id: number;
  taskId: number;
  workflowMode: string;
  predictedComplexity: number | null;
  estimatedDuration: number | null;
  actualDurationMinutes: number | null;
  outcome: string;
  success: boolean;
  createdAt: Date;
}

/**
 * How far a run may drift from its estimate and still count as predicted.
 *
 * This band is itself a claim, not a measurement — it is the first thing to
 * re-derive once enough settled rows exist. Stated as a constant so that
 * re-derivation is a one-line change with a visible before/after, rather than a
 * number buried in a comparison.
 */
export const DURATION_BAND = { lower: 0.5, upper: 2 } as const;

/**
 * Judge a complexity/mode prediction against what the run actually did.
 *
 * A failed run is `indeterminate`, not `wrong`: a failure says the task did not
 * finish, not that the mode chosen for it was the wrong one. Attributing it to
 * the prediction is the same error the baseline consistency check made when it
 * blamed every infrastructure outage on the decision.
 *
 * @param row - The record to judge. / 判定対象の行
 * @returns The verdict. / 判定
 */
export function judgeLearningRecord(row: LearningRecordRow): DecisionVerdict {
  if (row.predictedComplexity === null) return 'indeterminate';
  if (!row.success) return 'indeterminate';
  if (row.actualDurationMinutes === null) return 'pending';
  if (row.estimatedDuration === null || row.estimatedDuration <= 0) return 'partial';

  const ratio = row.actualDurationMinutes / row.estimatedDuration;
  return ratio >= DURATION_BAND.lower && ratio <= DURATION_BAND.upper ? 'correct' : 'partial';
}

/**
 * Project one learning record.
 *
 * @param row - Raw `WorkflowLearningRecord` row. / 生の学習レコード行
 * @returns The normalized decision. / 正規化された決定
 */
export function fromLearningRecord(row: LearningRecordRow): Decision {
  return {
    id: `record:${row.id}`,
    at: row.createdAt,
    taskId: row.taskId,
    kind: 'workflow_mode',
    subject: `${row.workflowMode} mode`,
    predicted: {
      complexity: row.predictedComplexity,
      mode: row.workflowMode,
      estimatedMinutes: row.estimatedDuration,
    },
    basis:
      row.predictedComplexity === null
        ? '予測が記録されていない'
        : `複雑度 ${row.predictedComplexity} から ${row.workflowMode} を選択`,
    outcome:
      row.actualDurationMinutes === null && row.outcome === 'completed'
        ? null
        : { actualMinutes: row.actualDurationMinutes, outcome: row.outcome },
    verdict: judgeLearningRecord(row),
    costUsd: 0,
    source: 'learning_record',
  };
}
