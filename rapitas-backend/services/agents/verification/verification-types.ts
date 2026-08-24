/**
 * verification-types
 *
 * Shared type definitions (check / result shapes) and the fail-closed
 * `unverifiableCheck` factory used by every verification check module.
 * Contains no check logic. Extracted from automated-verifier.ts (file-size split).
 */

export interface VerificationCheck {
  name:
    | 'lint'
    | 'typecheck'
    | 'test'
    | 'format'
    | 'generated-sync'
    | 'scope'
    | 'coverage'
    | 'runtime'
    | 'tamper'
    | 'acceptance';
  /** Whether the check was applicable and actually executed. */
  ran: boolean;
  /** True when the check passed (no new failures in the changed files). */
  ok: boolean;
  /** Number of failures attributed to the agent's changes. */
  errorCount: number;
  /** Truncated, human-readable evidence (real command output). */
  details: string;
  /**
   * True when the check SHOULD have run (tooling configured) but could not
   * execute — the gate fails closed instead of silently treating it as passed.
   */
  unverifiable?: boolean;
  /**
   * Test files that failed before the agent's changes (pre-existing failures).
   * Only set on 'test' checks when triage detected at least one pre-existing failure.
   * These are excluded from errorCount/ok so they don't false-block the gate.
   */
  preExistingFailures?: string[];
  /** Failures unattributable (baseline comparison indeterminate after retries) — not counted. */
  indeterminate?: boolean;
  /** Scoped test files left unattributed. Only set with `indeterminate` (task 659). */
  indeterminateFailures?: string[];
  /**
   * Out-of-plan changed files (repo-relative). Only set on failing 'scope'
   * checks — structured input for the history-contamination classifier
   * (worktree-rebuild-recovery), which must not re-parse `details` text.
   */
  offendingFiles?: string[];
}

export interface VerificationResult {
  /** True when every check that ran passed. */
  ok: boolean;
  /** Code files the agent added/modified (repo-relative). */
  changedFiles: string[];
  checks: VerificationCheck[];
  /** One-line human summary. */
  summary: string;
  /**
   * True when at least one check was unverifiable (configured tooling could not
   * run). Distinct from a normal failure: self-repair retries cannot fix it.
   */
  unverifiable?: boolean;
}

/**
 * Builds a check marking that a verification SHOULD have run (tooling configured)
 * but could not execute, so the gate must fail closed rather than silently pass.
 */
export function unverifiableCheck(
  name: 'lint' | 'typecheck' | 'test',
  details: string,
): VerificationCheck {
  return { name, ran: false, ok: false, errorCount: 0, details, unverifiable: true };
}
