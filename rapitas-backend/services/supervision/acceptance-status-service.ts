/**
 * AcceptanceStatusService
 *
 * Gathers supervision evidence (interventions, task outcomes, gate commits,
 * heartbeats, gaps, knowledge-reuse comparison, write health), judges the
 * acceptance bar and appends an `supervision_acceptance_snapshot` so the verdict
 * survives restarts. The API reads the newest snapshot and marks it stale rather
 * than presenting an old verdict as current.
 * Not responsible for the streak arithmetic — see streak-calculator.ts.
 */
import { createLogger } from '../../config/logger';
import { appendEvent, queryEvents } from '../memory/timeline';
import { readLastGateMutation, type GateMutationObservation } from './gate-mutation-paths';
import {
  flushPendingInterventions,
  getInterventionWriteHealth,
  listInterventions,
  syncInterventionsFromTransitions,
  type InterventionWriteHealth,
} from './intervention-detector';
import {
  readLatestKnowledgeReuseEval,
  type KnowledgeReuseAssessment,
} from './knowledge-reuse-comparison';
import {
  findSilences,
  listObservationGaps,
  readRecentHeartbeats,
} from './observation-gap-detector';
import { calculateStreak, type StreakInput } from './streak-calculator';
import { gatherTaskLandingEvidence, type TaskLandingEvidence } from './task-landing-evidence';
import {
  ACCEPTANCE_CORRELATION_ID,
  BACKEND_MONITOR_ID,
  SUPERVISION_SCHEMA_VERSION,
  parseAcceptanceSnapshotPayload,
  type AcceptanceReasonCode,
  type AcceptanceSnapshotPayload,
} from './supervision-events';

const log = createLogger('supervision:acceptance-status');

const DAY_MS = 24 * 3_600_000;
/** Interventions/outcomes older than this cannot affect a streak judged today. */
export const EVIDENCE_LOOKBACK_MS = 30 * DAY_MS;
/** Heartbeat history trusted for the observed-duration measure (≥ 24h bar). */
export const HEARTBEAT_HORIZON_MS = 3 * DAY_MS;
/** Max heartbeats read for the horizon (~3 days at 1/min plus margin). */
const HEARTBEAT_HORIZON_LIMIT = 6000;
/** A snapshot older than this is not a current verdict (5-min cadence + slack). */
export const SNAPSHOT_STALE_MS = 15 * 60_000;

// NOTE: Failure-cause classification moved to task-landing-evidence.ts with the
// transition queries; re-exported for existing importers.
export { isFailureCause } from './task-landing-evidence';

export interface AcceptanceEvidence {
  streak: StreakInput;
  writeHealth: InterventionWriteHealth;
  knowledge: KnowledgeReuseAssessment;
  gate: GateMutationObservation;
  heartbeatCount: number;
  blockingTaskIds: number[];
  landing: Pick<TaskLandingEvidence, 'classCounts' | 'landings'>;
  /** Open high-severity concerns; null when the backlog could not be read. */
  highSeverityOpenConcerns: number | null;
}

/** Counts open high-severity concerns; null on read failure (treated as present). */
async function countHighSeverityConcerns(): Promise<number | null> {
  try {
    const { listConcerns } = await import('../memory/concern-backlog-service');
    return (await listConcerns({ status: 'open', severity: 'high', limit: 1 })).total;
  } catch (err) {
    log.error({ err }, '[Supervision] Concern backlog read failed');
    return null;
  }
}

/**
 * Collects all evidence for one verdict from the DB and git.
 *
 * @param now - Judgement time / 判定時刻
 * @param heartbeatIntervalMs - Expected backend sampling cadence / 期待サンプリング周期
 * @returns Evidence bundle / 証跡一式
 */
export async function gatherAcceptanceEvidence(
  now: Date,
  heartbeatIntervalMs: number,
): Promise<AcceptanceEvidence> {
  const lookbackStart = new Date(now.getTime() - EVIDENCE_LOOKBACK_MS);
  const horizonStart = new Date(now.getTime() - HEARTBEAT_HORIZON_MS);

  await syncInterventionsFromTransitions(lookbackStart);
  await flushPendingInterventions();

  const [interventionRecords, landing, gate, heartbeats, recordedGaps, knowledge, concerns] =
    await Promise.all([
      listInterventions(lookbackStart, 1000),
      gatherTaskLandingEvidence(lookbackStart),
      readLastGateMutation(),
      readRecentHeartbeats(BACKEND_MONITOR_ID, HEARTBEAT_HORIZON_LIMIT, horizonStart),
      listObservationGaps(horizonStart, 1000),
      readLatestKnowledgeReuseEval(),
      countHighSeverityConcerns(),
    ]);

  const samples = heartbeats.samples;
  const times = samples.map((s) => s.createdAt.getTime());
  return {
    streak: {
      now,
      horizonStart,
      interventions: [
        ...interventionRecords.map((r) => ({ at: new Date(r.detectedAt), taskId: r.taskId })),
        ...landing.interventions,
      ],
      failures: landing.failures,
      // Only merge-evidenced, verified, criteria-backed landings count (bar v1).
      completions: landing.completions,
      nonQualifying: landing.nonQualifying,
      pending: landing.pending,
      subtaskExcluded: landing.subtaskExcluded,
      gateMutation: { at: gate.at, observable: gate.observable },
      // Reconstructed from heartbeats too, so a gap whose record write failed still counts.
      gaps: [...recordedGaps, ...findSilences(samples)],
      firstHeartbeatAt: times.length > 0 ? new Date(Math.min(...times)) : null,
      lastHeartbeatAt: times.length > 0 ? new Date(Math.max(...times)) : null,
      heartbeatIntervalMs,
      heartbeatHistoryTruncated: heartbeats.truncated,
    },
    writeHealth: getInterventionWriteHealth(),
    knowledge,
    gate,
    heartbeatCount: samples.length,
    blockingTaskIds: landing.blockingTaskIds,
    landing: { classCounts: landing.classCounts, landings: landing.landings },
    highSeverityOpenConcerns: concerns,
  };
}

/**
 * Judges the acceptance bar from gathered evidence. Pure.
 * `met` is the conjunction of: streak bar, sufficient knowledge-reuse evidence,
 * observation evidence present, and no possibly-lost intervention writes.
 *
 * @param evidence - Evidence bundle / 証跡一式
 * @returns Snapshot payload / スナップショットpayload
 */
export function evaluateAcceptance(evidence: AcceptanceEvidence): AcceptanceSnapshotPayload {
  const streak = calculateStreak(evidence.streak);
  const reasons = new Set<AcceptanceReasonCode>(streak.reasonCodes);
  const wh = evidence.writeHealth;
  if (wh.pendingSpooled > 0 || wh.corruptSpoolLines > 0 || wh.unspooledFailure || wh.scanFailed) {
    reasons.add('intervention_write_failed');
  }
  if (!evidence.knowledge.sufficientEvidence) reasons.add('knowledge_reuse_evidence_insufficient');
  if (evidence.heartbeatCount === 0) reasons.add('no_observation_evidence');
  if (evidence.highSeverityOpenConcerns !== 0) reasons.add('unresolved_high_severity_concern');
  const idsOf = (classes: string[]) =>
    evidence.landing.landings
      .filter((l) => classes.includes(l.landingClass))
      .map((l) => l.taskId)
      .join(',') || null;

  const k = evidence.knowledge.latest;
  return {
    schemaVersion: SUPERVISION_SCHEMA_VERSION,
    met: reasons.size === 0,
    streakCount: streak.streakCount,
    streakStartAt: streak.streakStartAt?.toISOString() ?? null,
    hoursSinceLastIntervention: Math.round(streak.observedHours * 100) / 100,
    observedGapMinutes: Math.round(streak.observedGapMinutes * 10) / 10,
    reasonCodes: [...reasons],
    blockingTaskIds: evidence.blockingTaskIds,
    evalSetVersion: k?.evalSetVersion ?? null,
    denominators: {
      requiredTasks: 10,
      requiredHours: 24,
      countedTaskIds: streak.countedTaskIds.join(',') || null,
      excludedTaskIds: streak.excludedTaskIds.join(',') || null,
      resetKind: streak.resetKind,
      interventionCount: evidence.streak.interventions.length,
      failureCount: evidence.streak.failures.length,
      completionEventCount: evidence.streak.completions.length,
      completedTaskCount: evidence.landing.landings.length,
      heartbeatCount: evidence.heartbeatCount,
      firstHeartbeatAt: evidence.streak.firstHeartbeatAt?.toISOString() ?? null,
      lastHeartbeatAt: evidence.streak.lastHeartbeatAt?.toISOString() ?? null,
      gateCommit: evidence.gate.commit,
      pendingInterventionWrites: wh.pendingSpooled,
      knowledgeMethodVersion: k?.methodVersion ?? null,
      knowledgePairedN: k?.pairedN ?? null,
      knowledgeMissingRetainedN: k?.missingRetainedN ?? null,
      knowledgeSuccessRateWithKB: k?.successRateWithKB ?? null,
      knowledgeSuccessRateWithoutKB: k?.successRateWithoutKB ?? null,
      knowledgeEffectSize: k?.effectSize ?? null,
      knowledgeIntervalOrPValue: k?.intervalOrPValue ?? null,
      landingQualifiedTaskIds: idsOf(['qualified']),
      landingPendingTaskIds: idsOf(['landing_pending', 'policy_unreadable']),
      nonQualifyingTaskIds: idsOf(['criteria_missing', 'merge_not_requested']),
      integrityViolationTaskIds: idsOf(['unverified_completion', 'publish_after_stop']),
      subtaskExcludedTaskIds: idsOf(['subtask']),
      landingClassCounts: JSON.stringify(evidence.landing.classCounts),
      highSeverityOpenConcerns: evidence.highSeverityOpenConcerns,
    },
  };
}

/**
 * Gathers, judges and appends one acceptance snapshot. Never throws.
 *
 * @param options - Expected heartbeat cadence and clock override / 周期と判定時刻
 * @returns The appended payload, or null when gathering/writing failed / 失敗時null
 */
export async function refreshAcceptanceSnapshot(options: {
  heartbeatIntervalMs: number;
  now?: Date;
}): Promise<AcceptanceSnapshotPayload | null> {
  try {
    const evidence = await gatherAcceptanceEvidence(
      options.now ?? new Date(),
      options.heartbeatIntervalMs,
    );
    const payload = evaluateAcceptance(evidence);
    await appendEvent({
      eventType: 'supervision_acceptance_snapshot',
      actorType: 'system',
      payload: payload as unknown as Record<string, unknown>,
      correlationId: ACCEPTANCE_CORRELATION_ID,
    });
    return payload;
  } catch (err) {
    // The API reports the resulting stale snapshot as unmet (snapshot_stale).
    log.error({ err }, '[Supervision] Acceptance snapshot refresh failed');
    return null;
  }
}

export interface AcceptanceStatus extends AcceptanceSnapshotPayload {
  snapshotAt: string | null;
  snapshotAgeMinutes: number | null;
}

/**
 * Reads the newest persisted verdict, degrading it to unmet when missing/stale.
 *
 * @param now - Clock override / 判定時刻
 * @returns Current acceptance status / 現在の受入状態
 */
export async function readAcceptanceStatus(now: Date = new Date()): Promise<AcceptanceStatus> {
  const { events } = await queryEvents({
    eventType: 'supervision_acceptance_snapshot',
    correlationId: ACCEPTANCE_CORRELATION_ID,
    limit: 1,
  });
  const event = events[0];
  const parsed = event ? parseAcceptanceSnapshotPayload(event.payload) : null;
  if (!event || !parsed) {
    return {
      schemaVersion: SUPERVISION_SCHEMA_VERSION,
      met: false,
      streakCount: 0,
      streakStartAt: null,
      hoursSinceLastIntervention: null,
      observedGapMinutes: 0,
      reasonCodes: ['no_observation_evidence', 'snapshot_stale'],
      blockingTaskIds: [],
      evalSetVersion: null,
      denominators: {},
      snapshotAt: null,
      snapshotAgeMinutes: null,
    };
  }
  const ageMs = now.getTime() - event.createdAt.getTime();
  const reasonCodes = [...parsed.reasonCodes];
  if (ageMs > SNAPSHOT_STALE_MS && !reasonCodes.includes('snapshot_stale'))
    reasonCodes.push('snapshot_stale');
  return {
    ...parsed,
    met: parsed.met && reasonCodes.length === 0,
    reasonCodes,
    snapshotAt: event.createdAt.toISOString(),
    snapshotAgeMinutes: Math.round(ageMs / 6000) / 10,
  };
}
