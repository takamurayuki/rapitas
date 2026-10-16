/**
 * miss-signatures.types
 *
 * API payload shapes for the detection-miss signature review page
 * (mirrors rapitas-backend routes/self-improvement/miss-signatures-routes).
 */

/** One suggestion row awaiting (or past) review. */
export interface MissSuggestion {
  id: number;
  caseId: number | null;
  signature: string;
  explanation: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/** Stateless approval-mode derivation result. */
export interface MissDecision {
  mode: 'manual' | 'auto';
  basis: 'initial_gate' | 'insufficient_data' | 'low_rejection' | 'high_rejection';
  rejectionRate: number | null;
}

/** Aggregate summary the /summary endpoint returns. */
export interface MissSummary {
  decision: MissDecision;
  counts: {
    pendingReview: number;
    approved: number;
    rejected: number;
    autoApplied: number;
    cases: number;
  };
  window: {
    days: number;
    samples: number;
    rejections: number;
  };
}
