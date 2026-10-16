/**
 * probe.types
 *
 * Type definitions for the phase-transition preflight probe layer (task 673):
 * probe target identity, execution context, and the outcome of a single probe
 * attempt or retry sequence. Not responsible for probe execution, caching, or
 * alerting — those live in the sibling modules that import these types.
 */
import type { WorkflowRole } from '../workflow-types';

/** Identifies a probe target; the set is fixed and covers all workflow roles. */
export type ProbeTargetId = 'db' | 'agent-endpoint';

/** Agent assignment resolved by the agent-prep stage, as needed by probes. */
export interface ProbeAgentConfig {
  agentType: string;
}

/** Inputs a probe target implementation needs to run its check. */
export interface ProbeContext {
  taskId: number;
  role: WorkflowRole;
  agentConfig: ProbeAgentConfig;
}

/** Result classification for one probe target after retries are exhausted. */
export type ProbeOutcome = 'success' | 'transient_retry' | 'permanent_failure';

/** A single probe target implementation. */
export interface ProbeTarget {
  id: ProbeTargetId;
  /**
   * Runs one check attempt; throws on failure (classified by probe-retry).
   * @param attempt - Zero-based attempt index, so a target can bypass its own
   *   caches on retry instead of re-reading the same stale result.
   */
  run: (ctx: ProbeContext, attempt: number) => Promise<void>;
  /**
   * Per-target timeout override in ms. Falls back to probe-retry's
   * PROBE_TIMEOUT_MS when omitted — only targets whose real work can
   * legitimately exceed that default (e.g. agent-endpoint, which awaits CLI
   * subprocess spawns) need to set this.
   */
  timeoutMs?: number;
}

/** Result of runProbeWithRetry for one target. */
export interface ProbeRetryResult {
  outcome: ProbeOutcome;
  attempts: number;
  latencyMs: number;
  errorMessage: string | null;
}
