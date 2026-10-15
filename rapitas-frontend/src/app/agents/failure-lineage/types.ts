/**
 * failure-lineage types
 *
 * Response shape of GET /agents/failure-lineage and the derived view rows used
 * by the /agents/failure-lineage page. Mirrors the backend failure-lineage
 * service types (every relation is an estimate).
 */

export type LineageLevel = 'ERROR' | 'WARN';
export type EdgeBasis = 'rule' | 'same_execution' | 'same_resource' | 'time_proximity';

export interface LineageNode {
  id: string;
  executionId: number;
  level: LineageLevel;
  template: string;
  templateId: string;
  resources: string[];
  timestamp: number;
  sequenceNumber: number;
  sample: string;
}

export interface LineageEdge {
  parentId: string;
  childId: string;
  /** 0.00-1.00 */
  confidence: number;
  basis: EdgeBasis;
  ruleId?: string;
}

export interface TemplateCluster {
  templateId: string;
  template: string;
  level: LineageLevel;
  count: number;
}

export interface RootCauseCandidate {
  nodeId: string;
  estimatedReducedCount: number;
}

export interface ChainValidation {
  chainId: string;
  label: string;
  expectedEdges: number;
  matchedEdges: number;
}

export interface LineageValidation {
  matchRate: number | null;
  knownEdgeCount: number;
  matched: number;
  mismatched: number;
  unchecked: number;
  liveConfirmed: number;
  decisionLogMatches: number;
  chains: ChainValidation[];
}

export interface FailureLineageData {
  nodes: LineageNode[];
  edges: LineageEdge[];
  clusters: TemplateCluster[];
  rootCauseCandidates: RootCauseCandidate[];
  validation: LineageValidation;
  truncated: boolean;
  isEstimated: true;
  windowHours: number;
}

/** One flattened tree row for the hierarchical list. */
export interface LineageRow {
  node: LineageNode;
  depth: number;
  /** Edge to the parent; null for roots. */
  parentEdge: LineageEdge | null;
  /** Estimated descendants if this node is a root-cause candidate. */
  reducedCount: number | null;
}
