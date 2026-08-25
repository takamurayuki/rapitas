/**
 * decision-ledger/from-decision-log
 *
 * Projects `DecisionLog` rows — the human-made plan approvals — into the shared
 * `Decision` shape. This is the one ledger that already worked end to end; it
 * is included so machine and human judgements are read the same way.
 */

import type { Decision, DecisionVerdict } from './types';

/** The `DecisionLog` columns this projection reads. */
export interface DecisionLogRow {
  id: number;
  taskId: number | null;
  decision: string;
  context: string;
  rationale: string | null;
  predictedOutcome: string;
  confidence: number;
  actualOutcome: string | null;
  calibration: string;
  createdAt: Date;
}

const VERDICT_BY_CALIBRATION: Record<string, DecisionVerdict> = {
  correct: 'correct',
  partial: 'partial',
  wrong: 'wrong',
  pending: 'pending',
};

/**
 * Project one decision-log row.
 *
 * @param row - Raw `DecisionLog` row. / 生の意思決定ログ行
 * @returns The normalized decision. / 正規化された決定
 */
export function fromDecisionLog(row: DecisionLogRow): Decision {
  return {
    id: `log:${row.id}`,
    at: row.createdAt,
    taskId: row.taskId,
    kind: 'plan_approval',
    subject: row.decision,
    predicted: { outcome: row.predictedOutcome, confidence: row.confidence },
    basis: row.rationale ?? row.context,
    outcome: row.actualOutcome ? { outcome: row.actualOutcome } : null,
    verdict: VERDICT_BY_CALIBRATION[row.calibration] ?? 'pending',
    // Human approvals carry no directly attributable spend.
    costUsd: 0,
    source: 'decision_log',
  };
}
