/**
 * self-verify-miss
 *
 * Barrel for the self-verify miss ledger (task 1602): recording a real-gate
 * failure that followed a passing self-verify run, classifying it, and the
 * read side (task 1586's judgment feed, the daily numbers).
 */
export { recordSelfVerifyMiss, recordRepairMisses, findPassingJob } from './miss-record';
export type { MissInput, PassingJob } from './miss-record';
export { classifyRepairMiss, kindOfGate, SELF_VERIFY_MISS_EVENT } from './miss-classify';
export type { SelfVerifyMissGate, SelfVerifyMissPayload, MissKind } from './miss-classify';
export { listJudgmentMisses, summarizeSelfVerifyMisses } from './miss-summary';
export type {
  SelfVerifyMissLesson,
  SelfVerifyMissSummary,
  MissBreakdown,
  MissCandidate,
} from './miss-summary';
