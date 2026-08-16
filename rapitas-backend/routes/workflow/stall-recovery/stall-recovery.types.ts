/**
 * stall-recovery.types
 *
 * Shared request/response types for the on-demand stall check + recovery API.
 * Domain-level types (verbosity, action) live in services/workflow/stall-summary
 * and are re-exported here so route consumers have a single import point.
 */
import type { StallRecoveryAction, StallVerbosity } from '../../../services/workflow/stall-summary';

export type { StallRecoveryAction, StallVerbosity };

/** One stalled task as reported by GET /workflow/stall-check. */
export interface StalledTaskReport {
  taskId: number;
  title: string;
  /** Staleness in whole minutes (>= threshold). */
  staleMinutes: number;
  /** One-sentence probable cause (TTS-readable). */
  cause: string;
  /** Verbosity-adjusted narration text for TTS / aria-live. */
  narration: string;
  /** Non-destructive actions first; `clear_git_lock` (destructive) last. */
  suggestedActions: StallRecoveryAction[];
}

/** Response of GET /workflow/stall-check. */
export interface StallCheckResponse {
  tasks: StalledTaskReport[];
  /** ISO timestamp of the scan. */
  checkedAt: string;
}

/** Request body of POST /workflow/tasks/:taskId/recover. */
export interface RecoverRequestBody {
  action: StallRecoveryAction;
}

/** Result of one recovery attempt. */
export interface RecoverResult {
  success: boolean;
  action: StallRecoveryAction;
  /** Human-readable outcome (Japanese, shown + narrated by the panel). */
  message: string;
}
