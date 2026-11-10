/**
 * Workflow Auto Commit — Result type
 *
 * The outcome shape of performAutoCommitAndPR, shared by its callers.
 * Not responsible for producing it (workflow-auto-commit.ts).
 */
import type { BaseSyncResult } from '../../services/workflow/pre-pr-base-sync';
import type { HarnessDriftSyncResult } from '../../services/workflow/harness-drift-sync';

/** Outcome of each step of performAutoCommitAndPR. */
export type AutoCommitPRResult = {
  requested?: {
    autoCommit: boolean;
    autoCreatePR: boolean;
    autoMergePR: boolean;
  };
  autoCommitResult?: {
    success: boolean;
    hash?: string;
    branch?: string;
    filesChanged?: number;
    error?: string;
  };
  autoPRResult?: { success: boolean; prUrl?: string; prNumber?: number; error?: string };
  /**
   * Pre-PR base-branch sync outcome (task 573 A). Kept as an INDEPENDENT field —
   * its detail must never be concatenated into the commit/PR error blob, or
   * merge wording could trip {@link isNoChangeCompletion} into a false
   * "no change" completion.
   */
  baseSyncResult?: BaseSyncResult;
  /**
   * Pre-gate harness sync outcome (2026-09-13): when the task branch predates
   * the runtime-verification harness, origin/<base> is merged in BEFORE the
   * gate so the runtime check can run instead of holding as UNVERIFIED. Kept
   * independent of the error blob for the same reason as baseSyncResult.
   */
  harnessSyncResult?: HarnessDriftSyncResult;
  /**
   * Pre-save stage (2026-09-13): tamper/secret screen (hard) and plan-scope
   * (advisory) evaluated on the tree BEFORE it is recorded as a local commit.
   */
  preSaveResult?: { ok: boolean; summary: string; secrets: string[]; scopeDetails?: string };
  /** HEAD the gate (or the post-sync re-gate) verified. */
  verifiedRevision?: string | null;
  /** HEAD at publication time; equals verifiedRevision whenever a PR was made. */
  publishedRevision?: string | null;
  /** Three-way verdict (task 1099): 'unknown' → draft PR only; 'fail' never reaches PR creation. */
  verdict?: 'pass' | 'fail' | 'unknown';
  autoMergeResult?: {
    success: boolean;
    mergeStrategy?: string;
    error?: string;
    deferred?: boolean;
  };
  worktreeCleanupResult?: { success: boolean; worktreePath?: string; error?: string };
  /**
   * True when the automated verification gate blocked (the agent's changes have
   * new lint/type errors). The caller MUST NOT then mark the task completed —
   * the gate already set it `blocked`.
   */
  verificationBlocked?: boolean;
  /** Infrastructure could not verify correctness; code repair is not justified. */
  verificationUnverifiable?: boolean;
  /**
   * Set when a review-hold override's binding (worktree + verify.md + diff) no
   * longer matched at commit time; nothing past that point was published.
   */
  bindingMismatch?: string;
  error?: string;
};
