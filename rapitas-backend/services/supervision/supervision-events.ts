/**
 * SupervisionEvents
 *
 * Payload contract for the five supervision TimelineEvent streams (task 904):
 * intervention, monitor heartbeat, observation gap, acceptance snapshot and
 * knowledge-reuse evaluation. Owns the allowed value sets and the parsers, so
 * detectors and the judge read the same vocabulary from one place.
 * Not responsible for writing events — see the individual detector modules.
 */
import { ACCEPTANCE_REASON_CODES, type AcceptanceReasonCode } from './supervision-reason-codes';

/**
 * Payload shape version. Timeline rows are append-only and can never be
 * rewritten, so readers branch on this when the shape changes.
 */
export const SUPERVISION_SCHEMA_VERSION = 1;

/** Correlation id used by every acceptance-judgement stream. */
export const ACCEPTANCE_CORRELATION_ID = 'supervision_acceptance';

/** The single backend-owned monitor id. External monitors use their own. */
export const BACKEND_MONITOR_ID = 'backend';

/**
 * Builds the correlation id for one monitor's heartbeat / gap stream.
 *
 * @param monitorId - Monitor identity, e.g. `backend` / モニター識別子
 * @returns Correlation id / 相関ID
 */
export function monitorCorrelationId(monitorId: string): string {
  return `supervision_monitor_${monitorId}`;
}

/**
 * Builds the correlation id for one task's supervision stream.
 *
 * @param taskId - Task id / タスクID
 * @returns Correlation id / 相関ID
 */
export function taskCorrelationId(taskId: number): string {
  return `task_${taskId}`;
}

/** How an intervention reached the system. */
export const INTERVENTION_SOURCE_KINDS = [
  'workflow_transition_user',
  'direct_commit',
  'completion_gate_violation',
  'manual_retry',
  'manual_approval',
  'external_monitor',
  'backend_timer',
] as const;
export type InterventionSourceKind = (typeof INTERVENTION_SOURCE_KINDS)[number];

/**
 * Why observation stopped for a stretch of time. Only asserted with evidence
 * (pid change, in-process write failures); a bare silence is `unknown`.
 */
export const OBSERVATION_GAP_REASON_KINDS = [
  'heartbeat_stale',
  'backend_restart',
  'monitor_process_absent',
  'event_write_failure',
  'unknown',
] as const;
export type ObservationGapReasonKind = (typeof OBSERVATION_GAP_REASON_KINDS)[number];

// NOTE: Reason codes moved to supervision-reason-codes.ts (file-size limit);
// re-exported so existing importers keep resolving.
export { ACCEPTANCE_REASON_CODES, type AcceptanceReasonCode } from './supervision-reason-codes';

/** A human/agent intervention that breaks the hands-off streak. */
export interface InterventionPayload {
  schemaVersion: number;
  taskId: number | null;
  sourceKind: InterventionSourceKind;
  detectedAt: string;
  workflowTransitionId?: number | null;
  note: string;
}

/** One liveness sample from a supervision monitor. */
export interface MonitorHeartbeatPayload {
  schemaVersion: number;
  monitorId: string;
  sourceKind: Extract<InterventionSourceKind, 'backend_timer' | 'external_monitor'>;
  intervalMs: number;
  pid?: number | null;
  status: 'alive';
}

/** A stretch of wall-clock time during which nothing was observing. */
export interface ObservationGapPayload {
  schemaVersion: number;
  monitorId: string;
  startAt: string;
  endAt: string;
  reasonKind: ObservationGapReasonKind;
  recoveredAt: string;
  note: string;
}

/** A point-in-time verdict on the supervision acceptance bar. */
export interface AcceptanceSnapshotPayload {
  schemaVersion: number;
  met: boolean;
  streakCount: number;
  streakStartAt: string | null;
  hoursSinceLastIntervention: number | null;
  observedGapMinutes: number;
  reasonCodes: AcceptanceReasonCode[];
  blockingTaskIds: number[];
  evalSetVersion: string | null;
  /** Measured denominators behind the verdict (counts, timestamps), shown as-is. */
  denominators: Record<string, number | string | boolean | null>;
}

/**
 * A knowledge-reuse comparison result. Deliberately carries no retrieval-count
 * or KB-size fields: the task requires that "searched more / stored more" can
 * never stand in for evidence of improvement.
 */
export interface KnowledgeReuseEvalPayload {
  schemaVersion: number;
  evalSetVersion: string;
  methodVersion: string;
  pairedN: number;
  /** Cases kept in the denominator despite missing/failed outcomes. */
  missingRetainedN: number;
  successRateWithKB: number | null;
  successRateWithoutKB: number | null;
  effectSize: number | null;
  intervalOrPValue: string | null;
  sufficientEvidence: boolean;
}

/** Narrows an unknown timeline payload to a record. */
function asRecord(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

/** True when the payload carries a schema version this build understands. */
function hasKnownVersion(rec: Record<string, unknown>): boolean {
  return (
    typeof rec.schemaVersion === 'number' &&
    rec.schemaVersion >= 1 &&
    rec.schemaVersion <= SUPERVISION_SCHEMA_VERSION
  );
}

/**
 * Validates an intervention payload read back from the timeline.
 *
 * @param payload - Raw JSON-parsed payload / 解析済みpayload
 * @returns The typed payload, or null when malformed / 不正ならnull
 */
export function parseInterventionPayload(payload: unknown): InterventionPayload | null {
  const rec = asRecord(payload);
  if (!rec || !hasKnownVersion(rec)) return null;
  if (!INTERVENTION_SOURCE_KINDS.includes(rec.sourceKind as InterventionSourceKind)) return null;
  if (typeof rec.detectedAt !== 'string' || Number.isNaN(Date.parse(rec.detectedAt))) return null;
  return {
    schemaVersion: rec.schemaVersion as number,
    taskId: typeof rec.taskId === 'number' ? rec.taskId : null,
    sourceKind: rec.sourceKind as InterventionSourceKind,
    detectedAt: rec.detectedAt,
    workflowTransitionId:
      typeof rec.workflowTransitionId === 'number' ? rec.workflowTransitionId : null,
    note: typeof rec.note === 'string' ? rec.note : '',
  };
}

/**
 * Validates a monitor heartbeat payload read back from the timeline.
 *
 * @param payload - Raw JSON-parsed payload / 解析済みpayload
 * @returns The typed payload, or null when malformed / 不正ならnull
 */
export function parseHeartbeatPayload(payload: unknown): MonitorHeartbeatPayload | null {
  const rec = asRecord(payload);
  if (!rec || !hasKnownVersion(rec)) return null;
  if (typeof rec.monitorId !== 'string' || rec.monitorId.length === 0) return null;
  if (typeof rec.intervalMs !== 'number' || rec.intervalMs <= 0) return null;
  if (rec.sourceKind !== 'backend_timer' && rec.sourceKind !== 'external_monitor') return null;
  return {
    schemaVersion: rec.schemaVersion as number,
    monitorId: rec.monitorId,
    sourceKind: rec.sourceKind,
    intervalMs: rec.intervalMs,
    pid: typeof rec.pid === 'number' ? rec.pid : null,
    status: 'alive',
  };
}

/**
 * Validates an observation-gap payload read back from the timeline.
 *
 * @param payload - Raw JSON-parsed payload / 解析済みpayload
 * @returns The typed payload, or null when malformed / 不正ならnull
 */
export function parseObservationGapPayload(payload: unknown): ObservationGapPayload | null {
  const rec = asRecord(payload);
  if (!rec || !hasKnownVersion(rec)) return null;
  if (!OBSERVATION_GAP_REASON_KINDS.includes(rec.reasonKind as ObservationGapReasonKind))
    return null;
  const startAt = typeof rec.startAt === 'string' ? Date.parse(rec.startAt) : NaN;
  const endAt = typeof rec.endAt === 'string' ? Date.parse(rec.endAt) : NaN;
  if (Number.isNaN(startAt) || Number.isNaN(endAt) || endAt < startAt) return null;
  return {
    schemaVersion: rec.schemaVersion as number,
    monitorId: typeof rec.monitorId === 'string' ? rec.monitorId : BACKEND_MONITOR_ID,
    startAt: rec.startAt as string,
    endAt: rec.endAt as string,
    reasonKind: rec.reasonKind as ObservationGapReasonKind,
    recoveredAt: typeof rec.recoveredAt === 'string' ? rec.recoveredAt : (rec.endAt as string),
    note: typeof rec.note === 'string' ? rec.note : '',
  };
}

/**
 * Validates a knowledge-reuse evaluation payload read back from the timeline.
 *
 * Evidence is treated as sufficient only when the producer said so AND the
 * paired sample is non-empty — an empty comparison can never be evidence.
 *
 * @param payload - Raw JSON-parsed payload / 解析済みpayload
 * @returns The typed payload, or null when malformed / 不正ならnull
 */
export function parseKnowledgeReuseEvalPayload(payload: unknown): KnowledgeReuseEvalPayload | null {
  const rec = asRecord(payload);
  if (!rec || !hasKnownVersion(rec)) return null;
  if (typeof rec.evalSetVersion !== 'string' || rec.evalSetVersion.length === 0) return null;
  if (typeof rec.methodVersion !== 'string' || rec.methodVersion.length === 0) return null;
  if (typeof rec.pairedN !== 'number' || rec.pairedN < 0) return null;
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const pairedN = rec.pairedN;
  return {
    schemaVersion: rec.schemaVersion as number,
    evalSetVersion: rec.evalSetVersion,
    methodVersion: rec.methodVersion,
    pairedN,
    missingRetainedN: typeof rec.missingRetainedN === 'number' ? rec.missingRetainedN : 0,
    successRateWithKB: num(rec.successRateWithKB),
    successRateWithoutKB: num(rec.successRateWithoutKB),
    effectSize: num(rec.effectSize),
    intervalOrPValue: typeof rec.intervalOrPValue === 'string' ? rec.intervalOrPValue : null,
    sufficientEvidence: rec.sufficientEvidence === true && pairedN > 0,
  };
}

/**
 * Validates an acceptance snapshot payload read back from the timeline.
 *
 * @param payload - Raw JSON-parsed payload / 解析済みpayload
 * @returns The typed payload, or null when malformed / 不正ならnull
 */
export function parseAcceptanceSnapshotPayload(payload: unknown): AcceptanceSnapshotPayload | null {
  const rec = asRecord(payload);
  if (!rec || !hasKnownVersion(rec)) return null;
  if (typeof rec.met !== 'boolean' || typeof rec.streakCount !== 'number') return null;
  const reasonCodes = Array.isArray(rec.reasonCodes)
    ? rec.reasonCodes.filter((c): c is AcceptanceReasonCode =>
        ACCEPTANCE_REASON_CODES.includes(c as AcceptanceReasonCode),
      )
    : [];
  return {
    schemaVersion: rec.schemaVersion as number,
    // A snapshot can only be "met" when it carries no unmet reasons; a row
    // claiming both is treated as unmet rather than trusted.
    met: rec.met === true && reasonCodes.length === 0,
    streakCount: rec.streakCount,
    streakStartAt: typeof rec.streakStartAt === 'string' ? rec.streakStartAt : null,
    hoursSinceLastIntervention:
      typeof rec.hoursSinceLastIntervention === 'number' ? rec.hoursSinceLastIntervention : null,
    observedGapMinutes: typeof rec.observedGapMinutes === 'number' ? rec.observedGapMinutes : 0,
    reasonCodes,
    blockingTaskIds: Array.isArray(rec.blockingTaskIds)
      ? rec.blockingTaskIds.filter((v): v is number => typeof v === 'number')
      : [],
    evalSetVersion: typeof rec.evalSetVersion === 'string' ? rec.evalSetVersion : null,
    denominators: Object.fromEntries(
      Object.entries(asRecord(rec.denominators) ?? {}).filter(
        ([, v]) => v === null || ['number', 'string', 'boolean'].includes(typeof v),
      ),
    ) as AcceptanceSnapshotPayload['denominators'],
  };
}
