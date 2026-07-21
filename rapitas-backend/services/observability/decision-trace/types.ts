/**
 * decision-trace/types
 *
 * Shared type definitions for the structured decision-audit trail
 * (AgentDecisionTrace). Runtime logic lives in recorder/dag-query/
 * consistency-checker; this module is types only.
 */

/** Category of a critical decision point. */
export type DecisionKind = 'api_call' | 'param_select' | 'resource_access';

/** One candidate that was considered at a decision point. */
export interface DecisionCandidate {
  /** Unique candidate id (e.g. a modelId, or a fixed string like "reuse"). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Optional attached info (masked before persistence). */
  meta?: Record<string, unknown>;
}

/** Input accepted by `recordDecision()`. Raw (unmasked) — masking happens inside the recorder. */
export interface RecordDecisionInput {
  taskId?: number | null;
  executionId?: number | null;
  sessionId?: number | null;
  /** Unique node id within the task (DAG node identity). */
  nodeKey: string;
  /** Predecessor nodeKeys this decision depends on (DAG parent edges). */
  parentKeys?: string[];
  kind: DecisionKind;
  /** Short human-readable label for the decision. */
  summary: string;
  /** Raw input to the decision (masked inside the recorder). */
  input?: Record<string, unknown>;
  /** All considered candidates (trimmed to top N=5 inside the recorder). */
  candidates: DecisionCandidate[];
  /** Id of the adopted candidate. */
  adoptedId: string;
  /** Why the adopted candidate was chosen. */
  adoptedReason: string;
  /** Candidate id -> why it was rejected (optional, may be empty). */
  rejectedReasons?: Record<string, string>;
}

/** Consistency verdict states persisted on AgentDecisionTrace.consistency. */
export type ConsistencyState = 'pending' | 'consistent' | 'inconsistent' | 'skipped';

/** One persisted AgentDecisionTrace row as returned by dag-query. */
export interface AgentDecisionTraceRow {
  id: number;
  taskId: number | null;
  executionId: number | null;
  sessionId: number | null;
  nodeKey: string;
  parentKeys: string;
  kind: string;
  summary: string;
  stage: string;
  inputMasked: string;
  candidatesMasked: string;
  adoptedId: string;
  adoptedReason: string;
  rejectedReasons: string;
  consistency: string;
  consistencyNote: string | null;
  createdAt: Date;
  verifiedAt: Date | null;
}
