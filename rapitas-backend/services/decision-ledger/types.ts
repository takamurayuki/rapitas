/**
 * decision-ledger/types
 *
 * One vocabulary for every judgement the system makes that can later be shown
 * right or wrong. Types only — the adapters that project the three storage
 * tables into this shape live alongside, and nothing here writes.
 */

/** What kind of judgement was made. */
export type DecisionKind =
  | 'model_tier'
  | 'workflow_mode'
  | 'risk_floor'
  | 'task_filing'
  | 'escalation'
  | 'plan_approval'
  | 'knowledge_use';

/**
 * How the judgement turned out.
 *
 * `indeterminate` is the load-bearing member: a decision whose outcome cannot
 * be attributed to it (an infrastructure failure, a missing prediction) must be
 * recordable as unjudgeable. A ledger that can only say right or wrong pushes
 * every such case into one of them and teaches the wrong lesson — which is
 * exactly what the baseline check did before this existed.
 */
export type DecisionVerdict = 'correct' | 'partial' | 'wrong' | 'indeterminate' | 'pending';

/** One judgement, normalized across the three tables that store them. */
export interface Decision {
  /** Stable id, namespaced by source so ids from different tables never collide. */
  id: string;
  /** When the decision was made. */
  at: Date;
  taskId: number | null;
  kind: DecisionKind;
  /** What the decision was about — e.g. "implementer phase". */
  subject: string;
  /** What was claimed at decision time. */
  predicted: unknown;
  /** Why it was decided that way (driver / reason). */
  basis: string;
  /** What actually happened, known only at settlement. */
  outcome: unknown;
  verdict: DecisionVerdict;
  /** Actual spend attributable to this decision, 0 when unknown. */
  costUsd: number;
  /** Which table this row came from — for provenance, not for branching on. */
  source: 'decision_trace' | 'learning_record' | 'decision_log';
}

/** Narrowing applied when reading the ledger. */
export interface DecisionFilter {
  kinds?: DecisionKind[];
  taskId?: number;
  /** Only decisions made at or after this instant. */
  since?: Date;
  /** Max rows per source before merging. Defaults to 500. */
  limit?: number;
}

/** Verdict counts plus the two ratios worth reading off them. */
export interface VerdictSummary {
  total: number;
  correct: number;
  partial: number;
  wrong: number;
  indeterminate: number;
  pending: number;
  /**
   * correct / (correct + partial + wrong). Excludes what could not be judged,
   * so an outage cannot masquerade as a drop in decision quality.
   */
  accuracy: number | null;
  /** indeterminate / total — how much of the ledger is unjudgeable. */
  indeterminateRate: number;
}
