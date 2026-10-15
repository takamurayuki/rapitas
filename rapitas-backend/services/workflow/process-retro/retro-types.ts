/**
 * RetroTypes
 *
 * Shared type definitions for the process retrospective (process-retro): the
 * task-completion review that inspects process METADATA (transitions, bounce
 * causes, dwell times) — not artifact contents. Kept dependency-free so the
 * pure modules (retro-evidence / retro-parse / retro-prompt) never form cycles.
 */

/** One WorkflowTransition row reduced to the fields the retrospective needs. */
export interface RetroTransitionRow {
  /**
   * Row id — only used as the sort tie-breaker for same-millisecond
   * transitions (auto-advance chains), so phase timings stay deterministic.
   */
  id: number;
  fromStatus: string | null;
  toStatus: string;
  actor: string;
  cause: string;
  phase: string | null;
  /** Raw metadata JSON string (WorkflowTransition.metadata, default "{}"). */
  metadata: string;
  invariantViolation: boolean;
  createdAt: Date;
}

/** Cause-class counters aggregated over a task's transitions. */
export interface CauseCounts {
  /** Transitions whose cause is a critic-gate bounce. */
  criticRebounds: number;
  /** Transitions whose cause is any repair/rework cause (includes replans). */
  repairCount: number;
  /** Replan-family subset, exposed separately for the replan_loop lens. */
  replanCount: number;
  /**
   * PR-creation-recovery causes (verify_pr_not_created /
   * verify_pr_retry_lightweight), counted independently of repairCount so the
   * retro can distinguish an unresolved content-repair loop from a PR-creation
   * retry already covered by blocked-pr-retry-recovery.ts's bounded
   * auto-recovery and blocked-task-policy.ts's retry-cap escalation (task 713;
   * see PR_RECOVERY_CAUSES in retro-evidence.ts).
   */
  prRecoveryCount: number;
  /** Transitions whose cause is an abnormal rejection. */
  anomalyCount: number;
  /**
   * transition_rejected rows correlated (via metadata.criticBouncePhase) to a
   * critic-gate bounce: the state machine correctly rejecting an in-flight
   * agent's save right after an async critic rollback. Part of the DESIGNED
   * self-repair chain — excluded from anomalyCount/invariantCount so the retro
   * AI cannot misread it as independent gate failures (task 620).
   */
  criticFollowRejections: number;
  /**
   * Rows flagged invariantViolation=true, excluding critic-bounce causes
   * (already counted in criticRebounds) and critic-follow rejections — i.e.
   * only genuine invariant breakage remains.
   */
  invariantCount: number;
}

/**
 * Machine-derived cause record for a pre-dispatch queue wait, built solely
 * from the task's own transitions so the retro (and any filed concern) records
 * the observed facts of WHY the task waited — interval, what happened during
 * the wait, and which cause finally dispatched it — instead of a hypothesis.
 * Root-cause background for the task#516 incident lives on
 * computeQueueWaitDetail (retro-evidence.ts).
 */
export interface QueueWaitDetail {
  /** Total pre-dispatch wait ms (always equals EvidenceBundle.queueWaitMs). */
  waitMs: number;
  /** ISO-8601 timestamp of the earliest transition (wait start). */
  waitStartAt: string;
  /** ISO-8601 timestamp of the first phase-bearing (dispatch) transition. */
  dispatchAt: string;
  /** Cause of the transition that ended the wait (e.g. intake_enriched). */
  dispatchCause: string;
  /** cause → occurrence count of transitions recorded during the wait. */
  preDispatchCauses: Record<string, number>;
}

/** Active self-experiment context shown to the retro AI (informational only). */
export interface RetroExperimentInfo {
  /** Workflow role under intervention. */
  role: string;
  /** Hypothesis-ledger entry the experiment tests. */
  hypothesisId: number;
  /** The hypothesis statement. */
  statement: string;
}

/** The machine-readable process-evidence bundle for one completed task. */
export interface EvidenceBundle extends CauseCounts {
  taskId: number;
  title: string;
  /** Every transition, oldest-first. */
  timeline: RetroTransitionRow[];
  /** Reason strings extracted from critic-bounce transitions' metadata. */
  criticReasons: string[];
  /** Total dwell time per workflow state (toStatus → ms); terminal state excluded. */
  phaseTimings: Record<string, number>;
  /**
   * Pre-dispatch queue wait ms: dwell before the first phase-bearing
   * transition, i.e. time the dispatcher (theme auto-run) was not executing
   * this task. Excluded from phaseTimings so non-running periods cannot
   * masquerade as phase_wallclock anomalies (task 567; incident task#516).
   */
  queueWaitMs: number;
  /**
   * Cause record for the queue wait (null when there was none). Satisfies the
   * acceptance criterion that an initial-trigger delay's cause is identified
   * AND recorded: the facts are persisted into the rendered evidence summary,
   * which is reused as the filed concern's bundle-summary section.
   */
  queueWaitDetail: QueueWaitDetail | null;
  /**
   * Set while a self-experiment is running (task 562). Informational for the
   * retro AI — MUST NOT enter isCleanRound, so experiments never force AI calls.
   */
  experiment?: RetroExperimentInfo;
}

/** Categories a retro finding may carry (fixed vocabulary, AI-validated). */
export type RetroCategory =
  | 'critic_loop'
  | 'repair_loop'
  | 'replan_loop'
  | 'anomaly_cause'
  | 'phase_wallclock'
  | 'gate_jurisdiction'
  | 'process_other';

/** Severity labels shared with the concern backlog (CONCERN_SEVERITIES). */
export type RetroSeverity = 'urgent' | 'high' | 'medium' | 'low';

/** One validated finding from the retro AI's structured output. */
export interface RetroFinding {
  category: RetroCategory;
  severity: RetroSeverity;
  /** True when the friction looks cross-task (systemic), not a one-off. */
  systemic: boolean;
  /** Normalized dedup slug (lowercase alnum + hyphens, 3-40 chars). */
  slug: string;
  /** Improvement/teaching recommendation (trimmed, capped at 500 chars). */
  recommendation: string;
  /** Trace facts backing the finding (capped at 1000 chars; may be empty). */
  evidence: string;
}

/** Alias: the shape parseFindings yields after validation/normalization. */
export type ParsedFinding = RetroFinding;
