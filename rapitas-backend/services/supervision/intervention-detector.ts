/**
 * InterventionDetector
 *
 * Records and reads the interventions that break a hands-off streak: user-driven
 * workflow transitions, manual status changes/retries/stops, completion-gate
 * violations and externally reported interventions.
 * Writes are fail-closed and durable — a write that throws is spooled to disk and
 * keeps the verdict unmet until that exact record reaches the DB, across restarts.
 * Not responsible for deciding the streak — see streak-calculator.ts.
 */
import { randomUUID } from 'crypto';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { appendEvent, queryEvents } from '../memory/timeline';
import {
  SUPERVISION_SCHEMA_VERSION,
  parseInterventionPayload,
  taskCorrelationId,
  type InterventionPayload,
  type InterventionSourceKind,
} from './supervision-events';
import { readSpool, removeFromSpool, spoolRecord } from './supervision-write-spool';

const log = createLogger('supervision:intervention-detector');

/** Actor labels on WorkflowTransition that mean a human drove the change. */
const HUMAN_ACTORS = ['user'];

/**
 * Transition causes that are operator actions even when the recorded actor is
 * `system` (the route records the role, not the caller). Matching on actor alone
 * would miss them.
 */
const MANUAL_CAUSE_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  sourceKind: InterventionSourceKind;
}> = [
  { pattern: /^task_retried$|^user_action_after_failure$/, sourceKind: 'manual_retry' },
  { pattern: /^manual_/, sourceKind: 'manual_approval' },
];

/**
 * In-process latches. Unlike the spool these cannot survive a restart, so they
 * are only used for failures that could not be spooled or re-derived.
 * - unspooledFailure: DB write AND spool write failed; never cleared in-process.
 * - scanFailed: the transition scan failed; cleared only by a later successful
 *   scan, which re-derives the same window from the audit table.
 */
let unspooledFailure = false;
let scanFailed = false;

export interface InterventionWriteHealth {
  pendingSpooled: number;
  corruptSpoolLines: number;
  unspooledFailure: boolean;
  scanFailed: boolean;
}

/**
 * Reports every reason an intervention may be missing from the timeline.
 *
 * @returns Write-health breakdown / 介入記録の健全性
 */
export function getInterventionWriteHealth(): InterventionWriteHealth {
  let pendingSpooled = 0;
  let corruptSpoolLines = 0;
  try {
    const spool = readSpool<InterventionPayload>();
    pendingSpooled = spool.records.length;
    corruptSpoolLines = spool.corruptLines;
  } catch {
    // An unreadable spool cannot prove "nothing pending".
    corruptSpoolLines = 1;
  }
  return { pendingSpooled, corruptSpoolLines, unspooledFailure, scanFailed };
}

/**
 * Whether any intervention may be unrecorded (spooled, unspoolable, scan failed).
 *
 * @returns true when the hands-off verdict must be unmet / 未達にすべきなら true
 */
export function hasInterventionWriteFailure(): boolean {
  const h = getInterventionWriteHealth();
  return h.pendingSpooled > 0 || h.corruptSpoolLines > 0 || h.unspooledFailure || h.scanFailed;
}

/** Test seam: resets the in-process latches (the spool file is left alone). */
export function resetInterventionWriteFailure(): void {
  unspooledFailure = false;
  scanFailed = false;
}

export interface RecordInterventionInput {
  taskId: number | null;
  sourceKind: InterventionSourceKind;
  note: string;
  workflowTransitionId?: number | null;
  detectedAt?: Date;
}

/** Writes one intervention payload to the timeline; throws on failure. */
async function persistIntervention(payload: InterventionPayload): Promise<void> {
  await appendEvent({
    eventType: 'supervision_intervention',
    actorType: payload.sourceKind === 'workflow_transition_user' ? 'user' : 'system',
    actorId: payload.taskId != null ? String(payload.taskId) : undefined,
    payload: payload as unknown as Record<string, unknown>,
    correlationId: payload.taskId != null ? taskCorrelationId(payload.taskId) : undefined,
  });
}

/**
 * Appends one intervention event.
 *
 * Never throws: a supervision write must not take down the caller's workflow.
 * A failure is spooled to disk with its original detectedAt, so the verdict stays
 * unmet until this record — not any other — is persisted.
 *
 * @param input - The intervention to record / 記録する介入
 * @returns true when the event was persisted to the DB / DBへ永続化できたら true
 */
export async function recordIntervention(input: RecordInterventionInput): Promise<boolean> {
  const payload: InterventionPayload = {
    schemaVersion: SUPERVISION_SCHEMA_VERSION,
    taskId: input.taskId,
    sourceKind: input.sourceKind,
    detectedAt: (input.detectedAt ?? new Date()).toISOString(),
    workflowTransitionId: input.workflowTransitionId ?? null,
    note: input.note,
  };

  try {
    await persistIntervention(payload);
    return true;
  } catch (err) {
    const spooled = spoolRecord({
      id: randomUUID(),
      kind: 'intervention',
      spooledAt: new Date().toISOString(),
      data: payload,
    });
    // FIXME: If both the DB and the spool file fail, only this latch remembers
    // the loss, and a restart erases it. No third store exists to fall back on.
    if (!spooled) unspooledFailure = true;
    log.error(
      { err, sourceKind: input.sourceKind, spooled },
      '[Supervision] Failed to record intervention',
    );
    return false;
  }
}

/**
 * Retries every spooled intervention, removing only those that persisted.
 *
 * @returns Counts of flushed and still-pending records / 再送成功数と残数
 */
export async function flushPendingInterventions(): Promise<{ flushed: number; pending: number }> {
  const { records } = readSpool<InterventionPayload>();
  const persisted = new Set<string>();
  for (const record of records) {
    try {
      await persistIntervention({
        ...record.data,
        note: `${record.data.note} [recovered_from_write_failure]`,
      });
      persisted.add(record.id);
    } catch (err) {
      log.warn({ err, id: record.id }, '[Supervision] Spooled intervention still not persisted');
    }
  }
  removeFromSpool(persisted);
  return { flushed: persisted.size, pending: records.length - persisted.size };
}

export interface InterventionRecord extends InterventionPayload {
  createdAt: Date;
}

/**
 * Reads recorded interventions in a time window, newest first.
 *
 * @param since - Window start / 集計開始時刻
 * @param limit - Max rows to read / 最大取得件数
 * @returns Parsed intervention records / 解析済み介入レコード
 */
export async function listInterventions(since: Date, limit = 500): Promise<InterventionRecord[]> {
  const { events } = await queryEvents({ eventType: 'supervision_intervention', since, limit });
  const records: InterventionRecord[] = [];
  for (const event of events) {
    const parsed = parseInterventionPayload(event.payload);
    if (parsed) records.push({ ...parsed, createdAt: event.createdAt });
  }
  return records;
}

/**
 * Classifies one transition as an intervention, or null when automation drove it.
 *
 * @param transition - Actor and cause of a WorkflowTransition / 遷移のactorとcause
 * @returns The intervention source kind, or null / 介入種別またはnull
 */
export function classifyTransition(transition: {
  actor: string;
  cause: string;
}): InterventionSourceKind | null {
  for (const { pattern, sourceKind } of MANUAL_CAUSE_PATTERNS) {
    if (pattern.test(transition.cause)) return sourceKind;
  }
  return HUMAN_ACTORS.includes(transition.actor) ? 'workflow_transition_user' : null;
}

/**
 * Mirrors operator-driven WorkflowTransition rows not yet in the supervision
 * timeline. The transition table is the existing audit trail, so a failed scan
 * is recoverable: the next successful scan re-derives the same window.
 *
 * @param since - Window start / 走査開始時刻
 * @returns Count of newly recorded interventions / 新規記録件数
 */
export async function syncInterventionsFromTransitions(since: Date): Promise<number> {
  let transitions: Array<{
    id: number;
    taskId: number;
    actor: string;
    cause: string;
    createdAt: Date;
  }>;
  let known: Set<number>;
  try {
    transitions = await prisma.workflowTransition.findMany({
      where: {
        createdAt: { gte: since },
        OR: [
          { actor: { in: HUMAN_ACTORS } },
          { cause: { startsWith: 'manual_' } },
          { cause: { in: ['task_retried', 'user_action_after_failure'] } },
        ],
      },
      select: { id: true, taskId: true, actor: true, cause: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    known = new Set(
      (await listInterventions(since))
        .map((r) => r.workflowTransitionId)
        .filter((id): id is number => id != null),
    );
  } catch (err) {
    // A failed scan means we cannot prove "no intervention" for the window.
    scanFailed = true;
    log.error({ err }, '[Supervision] Failed to scan workflow transitions');
    return 0;
  }

  let recorded = 0;
  for (const transition of transitions) {
    if (known.has(transition.id)) continue;
    const sourceKind = classifyTransition(transition);
    if (!sourceKind) continue;
    const ok = await recordIntervention({
      taskId: transition.taskId,
      sourceKind,
      note: `workflow transition by ${transition.actor}: ${transition.cause}`,
      workflowTransitionId: transition.id,
      detectedAt: transition.createdAt,
    });
    if (ok) recorded += 1;
  }
  scanFailed = false;
  return recorded;
}

/**
 * Records a completion-gate denial as an intervention.
 *
 * Called from the completion gate so a false-completion attempt is counted as a
 * supervision-relevant event without re-implementing the gate's own logic.
 *
 * @param taskId - Task whose completion was blocked / 完了を阻止されたタスク
 * @param reason - The gate's machine reason / ゲートの機械可読理由
 * @returns true when the event was persisted / 永続化できたら true
 */
export async function recordCompletionGateViolation(
  taskId: number,
  reason: string,
): Promise<boolean> {
  return recordIntervention({
    taskId,
    sourceKind: 'completion_gate_violation',
    note: `completion gate blocked completion: ${reason}`,
  });
}
