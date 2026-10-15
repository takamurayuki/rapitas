/**
 * failure-lineage-types
 *
 * Shared types for the failure-lineage (失敗の系譜図) pipeline: normalized
 * log events, estimated parent/child edges, root-cause candidates and the
 * known-chain validation result. Pure types — no runtime behaviour.
 */

/** Severity levels the pipeline keeps; everything else is discarded. */
export type LineageLevel = 'ERROR' | 'WARN';

/** A raw log row as read from `AgentExecutionLog` (already narrowed to the used columns). */
export interface RawLogRow {
  id: number;
  executionId: number;
  logChunk: string;
  logType: string;
  sequenceNumber: number;
  timestamp: Date | number;
}

/** One ERROR/WARN event after template normalization. */
export interface LineageNode {
  /** Stable id, `log-<AgentExecutionLog.id>`. */
  id: string;
  executionId: number;
  level: LineageLevel;
  /** Normalized template, e.g. `push rejected for <BRANCH>`. */
  template: string;
  /** Short stable hash of `template`; equal ids = same event cluster. */
  templateId: string;
  /** Resource keys found in the body, e.g. `branch:feature/x`, `task:12`. */
  resources: string[];
  /** Epoch milliseconds. */
  timestamp: number;
  sequenceNumber: number;
  /** Original text truncated to the normalization limit. */
  sample: string;
}

/** Evidence class behind an estimated edge, ordered strongest first. */
export type EdgeBasis = 'rule' | 'same_execution' | 'same_resource' | 'time_proximity';

/** An estimated parent → child relation. Always an inference, never a fact. */
export interface LineageEdge {
  parentId: string;
  childId: string;
  /** 0.00-1.00; see CONFIDENCE_BY_BASIS. */
  confidence: number;
  basis: EdgeBasis;
  /** Matched known-chain rule id when `basis === 'rule'`. */
  ruleId?: string;
}

/** Template cluster summary for the legend / list. */
export interface TemplateCluster {
  templateId: string;
  template: string;
  level: LineageLevel;
  count: number;
}

/** A root-cause candidate with the estimated number of downstream events. */
export interface RootCauseCandidate {
  nodeId: string;
  /** Estimated descendants that would disappear if this node were fixed. */
  estimatedReducedCount: number;
}

/** Per-chain golden-replay outcome. */
export interface ChainValidation {
  chainId: string;
  label: string;
  expectedEdges: number;
  matchedEdges: number;
}

/** Validation of the estimator against known failure chains / decisions. */
export interface LineageValidation {
  /** matched / knownEdgeCount; `null` when there is nothing to check against. */
  matchRate: number | null;
  knownEdgeCount: number;
  /** Known edges the estimator reproduced. */
  matched: number;
  /** Known edges the estimator failed to reproduce. */
  mismatched: number;
  /** Live edges whose template pair is not covered by any known chain. */
  unchecked: number;
  /** Live edges whose template pair equals a known-chain pair. */
  liveConfirmed: number;
  /** DecisionLog rows whose text mentions a known-chain keyword. */
  decisionLogMatches: number;
  chains: ChainValidation[];
}

/** Full lineage computation result. */
export interface LineageResult {
  nodes: LineageNode[];
  edges: LineageEdge[];
  clusters: TemplateCluster[];
  rootCauseCandidates: RootCauseCandidate[];
  validation: LineageValidation;
}
