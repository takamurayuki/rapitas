/**
 * ExperimentTypes
 *
 * Shared type definitions for the hypothesis-driven self-experiment loop
 * (ledger hypothesis → reversible role-prompt intervention → N-task measurement
 * → adopt/reject). Kept dependency-free so the pure modules
 * (experiment-metrics) and the I/O modules (experiment-store /
 * experiment-lifecycle) never form cycles — same policy as retro-types.
 */

/** Metrics aggregated over one measurement window (control or treatment). */
export interface ExperimentMetrics {
  /** Fraction of window tasks with ZERO critic-gate bounces (0..1). */
  criticPassRate: number;
  /** Mean repair/rework transition count per task. */
  avgRepair: number;
  /** Mean total workflow dwell time per task (ms), from phase timings. */
  avgDurationMs: number;
  /** Number of tasks the window aggregated. */
  sampleSize: number;
}

/** Outcome of comparing treatment metrics against control metrics. */
export type ExperimentVerdict = 'improved' | 'regressed' | 'no_diff' | 'insufficient';

/** Terminal outcome recorded to the experiment history. */
export type ExperimentOutcome = 'adopted' | 'rejected' | 'inconclusive' | 'aborted';

/**
 * The single active experiment, persisted as one JSON file in RAPITAS_DATA_DIR
 * (schema changes are prohibited — no DB row). File existence itself encodes
 * the "at most one concurrent experiment" invariant.
 */
export interface ActiveExperiment {
  /** Unique id: `exp_<hypothesisId>_<startedAtEpoch>`. */
  id: string;
  /** Hypothesis-ledger entry this experiment tests. */
  hypothesisId: number;
  /** The hypothesis statement (denormalized for display/history). */
  statement: string;
  /** Workflow role whose prompt receives the intervention (single role only). */
  role: string;
  /** The intervention text appended to the role prompt (reversible addendum). */
  addendum: string;
  /** Number of completed treatment tasks required before judgement. */
  targetN: number;
  /** Always 'running' — terminal experiments are removed from the active file. */
  status: 'running';
  /** ISO timestamp the experiment started. */
  startedAt: string;
  /** Metrics of the control window (the N completed tasks BEFORE the start). */
  controlMetrics: ExperimentMetrics;
  /** Completed task ids observed during the experiment (deduplicated). */
  treatmentTaskIds: number[];
}

/** One line of the append-only experiment history (JSONL, observability). */
export interface ExperimentHistoryEntry {
  /** The experiment as it was when it ended. */
  experiment: ActiveExperiment;
  /** Terminal outcome. */
  outcome: ExperimentOutcome;
  /** Treatment-window metrics at judgement time (null when aborted early). */
  treatmentMetrics: ExperimentMetrics | null;
  /** ISO timestamp the experiment ended. */
  endedAt: string;
}
