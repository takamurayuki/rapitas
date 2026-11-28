/**
 * self-verification-activity
 *
 * Barrel for the cross-process record of running self-verification jobs and
 * the per-execution reporter the agent watchdogs use.
 */
export {
  createActivityStore,
  getActivityStore,
  normalizeWorktreeKey,
  resolveActivityDir,
  SELF_VERIFICATION_ACTIVE_LIMIT_MS,
  FINISHED_TTL_MS,
  type ActivityStore,
  type ActivityStoreDeps,
  type ActivityRunRef,
  type ActivityOutcome,
  type SelfVerificationActivity,
} from './activity-store';
export {
  createSelfVerificationReporter,
  formatResultLine,
  formatWaitingLine,
  REAL_MONITOR_CLOCK,
  type MonitorClock,
  type SelfVerificationReporter,
  type SelfVerificationReporterOptions,
} from './activity-reporter';
