/**
 * PromptEvolutionTree types
 *
 * Shape of `GET /learning/prompt-evolution/tree`'s response (task #937) —
 * mirrors rapitas-backend/services/self-learning/prompt-evolution-tree.ts's
 * `PromptEvolutionTreeNode` on the wire (dates arrive as ISO strings).
 */

/** Copied verbatim from ComparisonSummary.uncertainty (backend) — not a formal statistical test, see plan.md. */
export type SignificanceLevel = 'low' | 'medium' | 'high';

/** Derived trust label for a lineage node. */
export type TreeConfidence = 'high' | 'medium' | 'low';

/** Node attribute 4/5: applicable conditions (dayOfWeek/modelVersion/userSegment). */
export interface ApplicableConditions {
  dayOfWeek: string[] | null;
  modelVersion: string[] | null;
  userSegment: string[] | null;
}

/** Node attribute 5/5: one recorded failure case. */
export interface FailureCase {
  occurredAt: string;
  description: string;
  relatedExecutionId: string | null;
  failureCause: string | null;
}

/** One node of the prompt-evolution lineage tree. */
export interface PromptEvolutionTreeNode {
  id: number;
  parentId: number | null;
  status: string;
  basePromptKey: string | null;
  /** Node attribute 1/5: applied task type/role. */
  taskType: string | null;
  /** Node attribute 2/5 (effect): performance delta. */
  performanceDelta: number;
  /** Node attribute 2/5 (significance side). */
  significanceLevel: SignificanceLevel | null;
  applicableConditions: ApplicableConditions;
  failureCases: FailureCase[];
  /** Node attribute 3/5: whether a shadow-run A/B comparison backs this row. */
  abTested: boolean;
  abComparisonRef: string | null;
  createdAt: string;
  /** Node attribute 5/5: derived trust label. */
  treeConfidence: TreeConfidence;
  children: PromptEvolutionTreeNode[];
}

export interface PromptEvolutionTreeResponse {
  roots: PromptEvolutionTreeNode[];
}
