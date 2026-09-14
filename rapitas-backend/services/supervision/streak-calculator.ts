/**
 * StreakCalculator
 *
 * Pure judgement of the hands-off operating streak: at least 24 observed hours
 * and 10 consecutive tasks completed with no intervention, failure, interruption
 * or gate mutation. Unobserved time is subtracted, and missing evidence is
 * reported as an unmet reason — never read as "nothing happened".
 * Not responsible for reading the DB/git — see acceptance-status-service.ts.
 */
import { GAP_INTERVAL_MULTIPLIER, sumGapMsWithin } from './observation-gap-detector';
import type { AcceptanceReasonCode } from './supervision-reason-codes';

/** Acceptance bar v1: consecutive tasks. */
export const REQUIRED_STREAK_TASKS = 10;
/** Acceptance bar v1: observed hands-off hours since the last reset. */
export const REQUIRED_STREAK_HOURS = 24;

export interface TimedTaskEvent {
  at: Date;
  taskId: number | null;
}

/** A completion that ran but did not meet bar v1 (no merge, no criteria, integrity breach). */
export interface NonQualifyingEvent extends TimedTaskEvent {
  kind: 'non_qualifying_completion' | 'integrity_violation';
  reasonCode: AcceptanceReasonCode;
}

/** A completion whose landing is not yet decided (merge pending / unobservable). */
export interface PendingLanding {
  taskId: number;
  reasonCode: AcceptanceReasonCode;
}

export interface GapInterval {
  startAt: string | Date;
  endAt: string | Date;
}

export interface StreakInput {
  now: Date;
  /** Only heartbeats/gaps after this are trusted for the duration measure. */
  horizonStart: Date;
  interventions: readonly TimedTaskEvent[];
  failures: readonly TimedTaskEvent[];
  /** Only `qualified` landings (merge-evidence time), never raw completed transitions. */
  completions: readonly TimedTaskEvent[];
  /** Completions that break the consecutive run without counting. */
  nonQualifying?: readonly NonQualifyingEvent[];
  /** Undecided landings: they block `met` but are neither a reset nor a failure. */
  pending?: readonly PendingLanding[];
  /** Subtasks: shown as excluded, never counted, never a reset. */
  subtaskExcluded?: readonly number[];
  gateMutation: { at: Date | null; observable: boolean };
  /** Recorded and heartbeat-reconstructed gaps; overlaps are merged. */
  gaps: readonly GapInterval[];
  firstHeartbeatAt: Date | null;
  lastHeartbeatAt: Date | null;
  heartbeatIntervalMs: number;
  heartbeatHistoryTruncated: boolean;
}

export type StreakResetKind =
  | 'intervention'
  | 'failure'
  | 'gate_mutation'
  | 'non_qualifying_completion'
  | 'integrity_violation'
  | null;

export interface StreakResult {
  conditionMet: boolean;
  streakCount: number;
  streakStartAt: Date | null;
  resetKind: StreakResetKind;
  observedHours: number;
  observedGapMinutes: number;
  countedTaskIds: number[];
  excludedTaskIds: number[];
  reasonCodes: AcceptanceReasonCode[];
}

/** Latest event time in a list, or null. */
function latest(events: readonly TimedTaskEvent[]): Date | null {
  let best: Date | null = null;
  for (const e of events) if (!best || e.at > best) best = e.at;
  return best;
}

/**
 * Computes the hands-off streak and every reason it falls short.
 *
 * @param input - Evidence gathered from the timeline, transitions and git / 収集済み証跡
 * @returns Streak figures and unmet reasons / ストリーク値と未達理由
 */
export function calculateStreak(input: StreakInput): StreakResult {
  const reasons = new Set<AcceptanceReasonCode>();
  const nonQualifying = input.nonQualifying ?? [];
  const lastIntervention = latest(input.interventions);
  const lastFailure = latest(input.failures);
  const gateAt = input.gateMutation.at;

  // The most recent of the three reset signals starts the streak over.
  const candidates: Array<{ at: Date; kind: Exclude<StreakResetKind, null> }> = [];
  if (lastIntervention) candidates.push({ at: lastIntervention, kind: 'intervention' });
  if (lastFailure) candidates.push({ at: lastFailure, kind: 'failure' });
  if (gateAt) candidates.push({ at: gateAt, kind: 'gate_mutation' });
  for (const n of nonQualifying) candidates.push({ at: n.at, kind: n.kind });
  candidates.sort((a, b) => b.at.getTime() - a.at.getTime());
  const reset = candidates[0] ?? null;

  if (!input.firstHeartbeatAt || !input.lastHeartbeatAt) {
    reasons.add('no_observation_evidence');
  }
  if (!input.gateMutation.observable) reasons.add('gate_mutation_unobservable');
  if (input.heartbeatHistoryTruncated) reasons.add('observation_history_truncated');

  // Without a reset signal the streak can only start when observation started.
  const startCandidates = [reset?.at, input.firstHeartbeatAt].filter((d): d is Date => d != null);
  const streakStartAt =
    startCandidates.length > 0
      ? new Date(Math.max(...startCandidates.map((d) => d.getTime())))
      : null;

  // A task touched by any intervention or failure never counts, even if it later completed.
  const tainted = new Set<number>();
  for (const e of [...input.interventions, ...input.failures])
    if (e.taskId != null) tainted.add(e.taskId);
  const counted = new Set<number>();
  const excluded = new Set<number>(input.subtaskExcluded ?? []);
  if (streakStartAt) {
    for (const c of input.completions) {
      if (c.taskId == null || c.at < streakStartAt) continue;
      (tainted.has(c.taskId) ? excluded : counted).add(c.taskId);
    }
  }

  let observedHours = 0;
  let observedGapMinutes = 0;
  if (streakStartAt && input.firstHeartbeatAt && input.lastHeartbeatAt) {
    const windowStart = new Date(Math.max(streakStartAt.getTime(), input.horizonStart.getTime()));
    const gaps: GapInterval[] = [...input.gaps];
    // Time before the first trusted heartbeat was observed by nobody.
    if (input.firstHeartbeatAt > windowStart)
      gaps.push({ startAt: windowStart, endAt: input.firstHeartbeatAt });
    // An ongoing silence is a gap in progress, not quiet running.
    const silenceMs = input.now.getTime() - input.lastHeartbeatAt.getTime();
    if (silenceMs > input.heartbeatIntervalMs * GAP_INTERVAL_MULTIPLIER) {
      gaps.push({ startAt: input.lastHeartbeatAt, endAt: input.now });
      reasons.add('monitor_heartbeat_stale');
    }
    const windowMs = Math.max(0, input.now.getTime() - windowStart.getTime());
    const gapMs = sumGapMsWithin(gaps, windowStart, input.now);
    observedHours = Math.max(0, windowMs - gapMs) / 3_600_000;
    observedGapMinutes = gapMs / 60_000;
  }

  const countOk = counted.size >= REQUIRED_STREAK_TASKS;
  const hoursOk = observedHours >= REQUIRED_STREAK_HOURS;
  if (!countOk) reasons.add('streak_task_count_below_threshold');
  if (!hoursOk) reasons.add('streak_duration_below_threshold');
  if (reset && (!countOk || !hoursOk)) {
    if (reset.kind === 'intervention') reasons.add('recent_intervention');
    if (reset.kind === 'failure') reasons.add('failure_or_interruption_in_streak');
    if (reset.kind === 'gate_mutation') reasons.add('self_gate_mutation');
    for (const n of nonQualifying) {
      if (n.kind === reset.kind && n.at.getTime() === reset.at.getTime()) reasons.add(n.reasonCode);
    }
  }
  // An undecided landing keeps the verdict open without claiming it failed.
  for (const p of input.pending ?? []) reasons.add(p.reasonCode);

  return {
    conditionMet: reasons.size === 0,
    streakCount: counted.size,
    streakStartAt,
    resetKind: reset?.kind ?? null,
    observedHours,
    observedGapMinutes,
    countedTaskIds: [...counted].sort((a, b) => a - b),
    excludedTaskIds: [...excluded].sort((a, b) => a - b),
    reasonCodes: [...reasons],
  };
}
