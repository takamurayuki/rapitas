/**
 * CompanionDigest types
 *
 * The shapes the companion digest reads (companion, task and transition rows)
 * and returns (items, events, decisions). Logic lives in companion-digest.ts.
 */
import type { RepairCauseKind } from '../workflow/repair-cause';

/** What a person has to decide on an accompanied task, if anything. */
export type DigestDecisionKind =
  | 'approve_plan'
  | 'answer_question'
  | 'review_hold'
  | 'release_halt';

/** What one transition in the window means to the user. */
export type DigestEventKind =
  | 'halted'
  | 'review_held'
  | 'question'
  | 'repair'
  | 'replanned'
  | 'plan_ready'
  | 'decided'
  | 'completed'
  | 'progress';

/** The companion row fields the digest reads. */
export interface DigestCompanionRow {
  taskId: number;
  lastDigestTransitionId: number | null;
  startedAt: Date | string;
}

/** The task fields the digest reads. */
export interface DigestTaskRow {
  id: number;
  title: string;
  status: string;
  workflowStatus: string | null;
  haltReason: string | null;
}

/** The transition fields the digest reads. */
export interface DigestTransitionRow {
  id: number;
  taskId: number;
  fromStatus: string | null;
  toStatus: string;
  cause: string;
  createdAt: Date | string;
  invariantViolation: boolean;
}

/** Repair bounces in the task's current repair window, by cause. */
export type DigestRepairSummary = Record<RepairCauseKind, number>;

/** One event shown in the digest. */
export interface DigestEvent {
  id: number;
  kind: DigestEventKind;
  cause: string;
  toStatus: string;
  at: string;
}

/** What the user must decide, and where to do it. */
export interface DigestDecision {
  kind: DigestDecisionKind;
  /** The halt code for `release_halt` (budget_*, jury_result_discarded, ...). */
  haltReason?: string;
  /** Why the review was held, for `review_hold`. */
  holdReason?: string;
  /** The screen that takes the decision (mobile route). */
  link: string;
}

/** One accompanied task's digest. */
export interface DigestItem {
  taskId: number;
  title: string;
  status: string;
  workflowStatus: string | null;
  haltReason: string | null;
  /** Counts of what happened since the cursor. */
  since: {
    transitions: number;
    halts: number;
    holds: number;
    questions: number;
    repairs: number;
    replans: number;
  };
  /** The newest few events since the cursor, newest first. */
  recent: DigestEvent[];
  /** Repair bounces in the current repair window, and the most frequent cause. */
  repairs: { total: number; topCause: RepairCauseKind | null };
  decision: DigestDecision | null;
  /** The transition id to report back as seen; null when nothing new. */
  cursor: number | null;
}

/** The whole digest. */
export interface CompanionDigest {
  items: DigestItem[];
  /** How many items wait on a person. */
  decisionCount: number;
  checkedAt: string;
}
