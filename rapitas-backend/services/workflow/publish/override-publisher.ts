/**
 * override-publisher
 *
 * The commit/PR operations a review-hold override publishes through, as an
 * injected dependency. The implementations live in the routes layer
 * (workflow-auto-commit.ts, file-save/verify-commit-pr-gate-blocked.ts) and
 * are handed in by the HTTP route that resolves the hold.
 * Not responsible for deciding what an override's outcome means
 * (review-hold-publish.ts).
 *
 * NOTE: An interface instead of an import because services must not import
 * routes (import-graph rule services-must-not-import-routes, #1410). The gate
 * handler is not moved down: verify-self-repair-resume.ts attributes repair
 * telemetry by the `file-save/verify-commit-pr-gate-blocked` path in the stack.
 */
import type { PublishBinding } from './workflow-auto-commit-binding';
import type { AutoCommitPRResult } from './workflow-auto-commit-types';

/** Commit/PR operations a human override publishes with. */
export interface OverridePublisher {
  /** Commit, push, open the PR (and merge when requested), bound to `binding`. */
  performAutoCommitAndPR(
    taskId: number,
    verifyContent: string,
    opts: { binding: PublishBinding },
  ): Promise<AutoCommitPRResult>;
  /** Whether a step's own error confirms there was nothing to publish. */
  isNoChangeCompletion(p: { errorBlob: string; filesChanged: number | undefined }): boolean;
  /** Route a verification-gate failure into the bounded repair loop. */
  handleVerifyGateBlocked(params: {
    taskId: number;
    gateReason: string;
    gateRecoveryBlocked: null;
    savedContent: string;
  }): Promise<unknown>;
}
