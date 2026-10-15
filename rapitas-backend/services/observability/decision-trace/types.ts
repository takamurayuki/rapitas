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

/**
 * Structural subset of the generated `agentDecisionTrace` Prisma delegate
 * that this module uses.
 *
 * NOTE: Worktrees symlink `generated/` to the MAIN checkout, whose Prisma
 * client is regenerated from whatever schema that checkout currently has.
 * Until this branch's schema lands there, the delegate is absent from the
 * generated types (and undefined at runtime — callers already tolerate that
 * via try/catch). Typing the access structurally keeps `tsc` green in both
 * client generations instead of failing TS2339 in stale worktrees.
 */
export interface AgentDecisionTraceDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  findMany(args: Record<string, unknown>): Promise<AgentDecisionTraceRow[]>;
  update(args: Record<string, unknown>): Promise<unknown>;
  updateMany(args: Record<string, unknown>): Promise<unknown>;
}

/** Prisma-client shape exposing the delegate (cast target for consumers). */
export interface DecisionTraceClient {
  agentDecisionTrace: AgentDecisionTraceDelegate;
}

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
