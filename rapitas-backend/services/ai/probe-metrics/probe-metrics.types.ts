/**
 * probe-metrics.types
 *
 * Type definitions for the preflight probe measurement layer (task 673): one
 * JSONL record per executed probe stage plus the aggregated per-target metric
 * shape served by GET /agents/probe-metrics. Cache hits are never recorded
 * (see plan.md's cache strategy) — only actually-executed probes land here.
 * Not responsible for probe execution — measurement only.
 */
import type { ProbeOutcome, ProbeTargetId } from '../../workflow/probe/probe.types';
import type { WorkflowRole } from '../../workflow/workflow-types';

/** One JSONL line in `${RAPITAS_DATA_DIR}/probe-metrics/attempts.jsonl`. */
export interface ProbeAttemptRecord {
  /** Epoch ms at record time (injected by the caller, never Date.now() here). */
  tsMs: number;
  taskId: number;
  /** Workflow role the probe ran ahead of. */
  role: WorkflowRole;
  targetId: ProbeTargetId;
  outcome: ProbeOutcome;
  attempts: number;
  latencyMs: number;
  errorMessage: string | null;
}

/** Aggregated stats for one probe target within the window. */
export interface ProbeMetric {
  targetId: ProbeTargetId;
  attempts: number;
  successes: number;
  transientRetries: number;
  permanentFailures: number;
  /** successes / attempts (0 when attempts is 0 — never NaN). */
  successRate: number;
  avgLatencyMs: number;
  /** attempts < minSamples — UI renders a "サンプル不足" hint. */
  lowSample: boolean;
}
