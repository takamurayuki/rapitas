/**
 * verification-check-types
 *
 * Shapes shared by the automated verifier and its split-out check modules:
 * one check result, the overall result and the caller options. Holds no
 * logic. Split out of automated-verifier.ts (file-size limit, task 1602).
 */
import type { RuntimeEnvCause } from './runtime-smoke/runtime-server-registry-types';

/** Cap how much raw output a check keeps in its `details`. */
export const MAX_DETAIL_CHARS = 2_000;

/** Every check name the verifier can report. */
export type VerificationCheckName =
  | 'lint'
  | 'typecheck'
  | 'test'
  | 'format'
  | 'generated-sync'
  | 'scope'
  | 'coverage'
  | 'runtime'
  | 'tamper'
  | 'acceptance'
  | 'schema-change'
  | 'red-state'
  | 'file-size'
  // NOTE: task 1602 — CI/pre-save parity checks run from the shared catalog.
  | 'import-graph'
  | 'docs-drift'
  | 'todos'
  | 'secret'
  | 'attribution';

export interface VerificationCheck {
  name: VerificationCheckName;
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
  passedCount?: number;
  cause?: RuntimeEnvCause;
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
  /** Repo-relative files the failure points at (task 1602; set on failing checks). */
  failureFiles?: string[];
  /** What the real gate (CI / pre-save) reports for this check (task 1602). */
  gateMessage?: string;
  /** How to fix a failure of this check (task 1602). */
  fixHint?: string;
  /** True when the check is reported but excluded from the overall verdict. */
  advisory?: boolean;
}

export interface VerificationResult {
  /** True when every check that ran passed. */
  ok: boolean;
  /** Code files the agent added/modified (repo-relative). */
  changedFiles: string[];
  checks: VerificationCheck[];
  /** One-line human summary. */
  summary: string;
  /** True when a check was unverifiable (tooling couldn't run) — distinct from a normal failure: self-repair can't fix it. */
  unverifiable?: boolean;
  /** Three-way verdict (task 1099): 'fail' beats 'unknown'. */
  verdict: 'pass' | 'fail' | 'unknown';
}

/** Optional inputs for runAutomatedVerification. */
export interface VerificationOptions {
  /** plan.md content; parseable paths in it also drive the (advisory) scope check. */
  planContent?: string | null;
  /** Extra paths the tamper tripwire accepts — plan-less tasks' spec-declared tests. */
  tamperAllowlist?: string[];
  /**
   * Force the coverage gate for this run (bug-fix tasks must ship a
   * reproducing test) regardless of the RAPITAS_REQUIRE_TESTS env opt-in.
   */
  requireTests?: boolean;
  /**
   * The branch this task's worktree was actually cut from (e.g.
   * `AgentExecutionConfig.targetBranch`), tried before the develop/main/master
   * guess when resolving the diff base. See diffBaseRef's doc comment.
   */
  preferredBaseBranch?: string | null;
  /**
   * Task whose Theme's runtimeConfigJson the runtime-smoke stage should
   * prefer over a rapitas.runtime.json file, if set. See
   * runtime-config.ts's resolveRuntimeConfig.
   */
  taskId?: number;
  /**
   * The task's acceptance criteria; when non-empty the ADVISORY acceptance
   * self-check matches each criterion against the changed files (task 617 —
   * bounce classes A/B were 44% of verify bounces). Omit to skip the check.
   */
  acceptanceCriteria?: string[];
  /**
   * Task title + description, used by the acceptance self-check's
   * unrelated-diff (608-type) detection alongside the criteria tokens.
   */
  taskText?: string;
}
