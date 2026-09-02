/**
 * RecoveryManager
 *
 * Public facade that re-exports all recovery and resume functionality.
 * Consumers should import from this file to maintain backward compatibility.
 * Implementation is split across stale-execution-recovery.ts and execution-resume.ts.
 */

export {
  recoverStaleExecutions,
  getInterruptedExecutions,
  startExecutionLeaseSweep,
  sweepDeadLeaseExecutions,
} from './stale-execution-recovery';

export {
  resumeInterruptedExecution,
  buildResumePrompt,
  ResumeLockConflictError,
} from './execution-resume';
