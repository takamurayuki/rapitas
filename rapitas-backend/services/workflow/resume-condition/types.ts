/**
 * resume-condition/types
 *
 * Shared types and constants for structured resume conditions on blocked tasks.
 * Persistence is append-only WorkflowTransition rows (no schema change); this
 * module holds only the shapes — NOT the storage or evaluation logic.
 */
import type { BlockedExclusionReason } from '../blocked-task-policy';

/** Lifetime of one approved condition: valid for a single stop, 24h at most. / 有効期限(24時間) */
export const RESUME_CONDITION_TTL_MS = 24 * 60 * 60_000;

/** WorkflowTransition.cause written when a human approves a condition. */
export const RESUME_CONDITION_APPROVED_CAUSE = 'resume_condition_approved';

/** WorkflowTransition.cause written when a condition is expired/invalidated. */
export const RESUME_CONDITION_REVOKED_CAUSE = 'resume_condition_revoked';

/** Stop reasons a human answer can legitimately change; the other four stay excluded. */
export const RESUMABLE_REASONS = [
  'retry_cap_exhausted',
  'pr_recovery_exhausted',
  'verify_repair_exhausted',
  'verify_no_convergence',
] as const satisfies readonly BlockedExclusionReason[];

/** A stop reason that may be released by an approved condition. */
export type ResumableReason = (typeof RESUMABLE_REASONS)[number];

/** Allowed answers for the `verify_repair_exhausted` choice question. */
export const REPAIR_STRATEGY_CHOICES = ['scope_reduced', 'criteria_clarified'] as const;

/** Typed condition: free text is never stored, only one of these shapes. */
export type ResumeConditionSpec =
  | { kind: 'boolean'; value: true }
  | { kind: 'choice'; value: (typeof REPAIR_STRATEGY_CHOICES)[number] }
  | { kind: 'file_path'; value: string };

/** Task facts captured at approval; any drift invalidates the condition. */
export interface ResumeConditionSnapshot {
  status: string;
  workflowStatus: string | null;
  stopMarkerId: number;
}

/** One approved resume condition. / 承認済み再開条件 */
export interface ResumeCondition {
  questionId: string;
  taskId: number;
  reason: ResumableReason;
  spec: ResumeConditionSpec;
  approvedAt: number;
  expiresAt: number;
  snapshot: ResumeConditionSnapshot;
}

/** Minimal WorkflowTransition row shape the pure logic needs. */
export interface ResumeEventRow {
  id: number;
  cause: string;
  createdAt: Date;
  metadata: string | null;
}

/** Live task facts compared against a condition's snapshot. */
export interface ResumeTaskContext {
  status: string;
  workflowStatus: string | null;
  stopMarkerId: number;
}

/** A single structured question for one stop. / 構造化質問(1問) */
export interface ResumeQuestion {
  kind: 'question';
  reason: ResumableReason;
  text: string;
  spec: ResumeConditionSpec['kind'];
  choices?: readonly string[];
}

/** Result of buildResumeQuestion. */
export type ResumeQuestionResult = ResumeQuestion | { kind: 'not_resumable'; reason: string };
