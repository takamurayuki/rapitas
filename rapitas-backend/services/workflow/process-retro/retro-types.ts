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
  /** Transitions whose cause is an abnormal rejection. */
  anomalyCount: number;
  /** Rows flagged invariantViolation=true. */
  invariantCount: number;
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
   * transition (auto-run stopped / server down). Excluded from phaseTimings so
   * non-running periods cannot masquerade as phase_wallclock anomalies (task 567).
   */
  queueWaitMs: number;
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
