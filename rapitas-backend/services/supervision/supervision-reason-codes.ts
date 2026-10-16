/**
 * SupervisionReasonCodes
 *
 * The single vocabulary of machine-readable reasons the supervision acceptance
 * bar is not met. Detectors, the streak calculator, the landing classifier and
 * the UI all read this list; `supervision-events.ts` re-exports it.
 */

/**
 * Every one of these forces `met=false`; there is no code path that reports
 * `met=true` alongside a non-empty reason list.
 */
export const ACCEPTANCE_REASON_CODES = [
  'streak_task_count_below_threshold',
  'streak_duration_below_threshold',
  'recent_intervention',
  'self_gate_mutation',
  'observation_gap_present',
  'no_observation_evidence',
  'snapshot_stale',
  'intervention_write_failed',
  'knowledge_reuse_evidence_insufficient',
  'monitor_heartbeat_stale',
  'failure_or_interruption_in_streak',
  'gate_mutation_unobservable',
  'observation_history_truncated',
  // Task landing (acceptance bar v1: "through the actual merge").
  'landing_evidence_pending',
  'landing_evidence_unobservable',
  'merge_not_requested',
  'acceptance_criteria_missing',
  'unverified_completion_detected',
  'publish_after_stop_detected',
  'subtask_not_counted',
  'unresolved_high_severity_concern',
] as const;
export type AcceptanceReasonCode = (typeof ACCEPTANCE_REASON_CODES)[number];
