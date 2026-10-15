/**
 * ObservationGapDetector
 *
 * Detects stretches of wall-clock time during which no monitor was sampling, and
 * records them so those minutes are subtracted from "hands-off" time instead of
 * being credited as quiet running. Gaps are always re-derivable from the
 * persisted heartbeat stream, so a failed gap write or a restart cannot erase one.
 * Not responsible for emitting heartbeats — see supervision-heartbeat-scheduler.
 */
import { createLogger } from '../../config/logger';
import { appendEvent, queryEvents } from '../memory/timeline';
import {
  BACKEND_MONITOR_ID,
  SUPERVISION_SCHEMA_VERSION,
  monitorCorrelationId,
  parseHeartbeatPayload,
  parseObservationGapPayload,
  type ObservationGapPayload,
  type ObservationGapReasonKind,
} from './supervision-events';

const log = createLogger('supervision:observation-gap-detector');

/**
 * A gap is declared once the silence exceeds this multiple of the expected
 * sampling interval. Three intervals tolerates one dropped sample plus jitter
 * without inventing gaps on a healthy monitor.
 */
export const GAP_INTERVAL_MULTIPLIER = 3;

/** Heartbeats re-scanned per cycle (~1h at 1/min) to recover unrecorded gaps. */
export const GAP_RECONCILE_SAMPLES = 60;

export interface HeartbeatSample {
  monitorId: string;
  intervalMs: number;
  pid: number | null;
  sourceKind: 'backend_timer' | 'external_monitor';
  createdAt: Date;
}

export interface DetectedGap {
  monitorId: string;
  startAt: Date;
  endAt: Date;
  reasonKind: ObservationGapReasonKind;
  note: string;
}

/**
 * Reads heartbeat samples for a monitor, newest first. Always bounded by
 * `limit`: heartbeats accrue ~1440 rows/day.
 *
 * @param monitorId - Monitor identity / モニター識別子
 * @param limit - Max samples / 最大取得件数
 * @param since - Optional window start / 取得開始時刻（任意）
 * @returns Samples newest first and whether the window was truncated / サンプルと打ち切り有無
 */
export async function readRecentHeartbeats(
  monitorId: string = BACKEND_MONITOR_ID,
  limit = 2,
  since?: Date,
): Promise<{ samples: HeartbeatSample[]; truncated: boolean }> {
  const { events, total } = await queryEvents({
    eventType: 'supervision_monitor_heartbeat',
    correlationId: monitorCorrelationId(monitorId),
    since,
    limit,
  });
  const samples: HeartbeatSample[] = [];
  for (const event of events) {
    const parsed = parseHeartbeatPayload(event.payload);
    if (parsed) {
      samples.push({
        monitorId: parsed.monitorId,
        intervalMs: parsed.intervalMs,
        pid: parsed.pid ?? null,
        sourceKind: parsed.sourceKind,
        createdAt: event.createdAt,
      });
    }
  }
  return { samples, truncated: total > events.length };
}

/**
 * Names the stop reason only when the samples carry evidence for it. Silence
 * length alone never implies a restart or an absent process.
 */
function classifyGap(
  previous: HeartbeatSample,
  newest: HeartbeatSample,
  writeFailureTimes: readonly Date[],
): ObservationGapReasonKind {
  if (previous.pid != null && newest.pid != null && previous.pid !== newest.pid) {
    return newest.sourceKind === 'external_monitor' ? 'monitor_process_absent' : 'backend_restart';
  }
  if (previous.pid != null && previous.pid === newest.pid) {
    const from = previous.createdAt.getTime();
    const to = newest.createdAt.getTime();
    if (writeFailureTimes.some((t) => t.getTime() > from && t.getTime() < to)) {
      return 'event_write_failure';
    }
    // Same process kept running but did not sample: a stalled timer/event loop.
    return 'heartbeat_stale';
  }
  return 'unknown';
}

/**
 * Finds every over-threshold silence between consecutive samples. Pure.
 *
 * @param samples - Heartbeat samples in any order / ハートビート（順不同）
 * @param writeFailureTimes - In-process heartbeat write failures (evidence) / 書込失敗時刻
 * @returns Gaps oldest first / 古い順の欠落
 */
export function findSilences(
  samples: readonly HeartbeatSample[],
  writeFailureTimes: readonly Date[] = [],
): DetectedGap[] {
  const ordered = [...samples].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const gaps: DetectedGap[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const newest = ordered[i];
    const silenceMs = newest.createdAt.getTime() - previous.createdAt.getTime();
    if (silenceMs <= previous.intervalMs * GAP_INTERVAL_MULTIPLIER) continue;
    gaps.push({
      monitorId: previous.monitorId,
      startAt: previous.createdAt,
      endAt: newest.createdAt,
      reasonKind: classifyGap(previous, newest, writeFailureTimes),
      note: `no heartbeat for ${Math.round(silenceMs / 1000)}s (expected every ${Math.round(previous.intervalMs / 1000)}s)`,
    });
  }
  return gaps;
}

/**
 * Records one observation gap.
 *
 * @param gap - The gap to persist / 記録する観測欠落
 * @returns true when persisted / 永続化できたら true
 */
export async function recordObservationGap(gap: DetectedGap): Promise<boolean> {
  const payload: ObservationGapPayload = {
    schemaVersion: SUPERVISION_SCHEMA_VERSION,
    monitorId: gap.monitorId,
    startAt: gap.startAt.toISOString(),
    endAt: gap.endAt.toISOString(),
    reasonKind: gap.reasonKind,
    recoveredAt: gap.endAt.toISOString(),
    note: gap.note,
  };
  try {
    await appendEvent({
      eventType: 'supervision_observation_gap',
      actorType: 'system',
      actorId: gap.monitorId,
      payload: payload as unknown as Record<string, unknown>,
      correlationId: monitorCorrelationId(gap.monitorId),
    });
    return true;
  } catch (err) {
    log.error({ err, monitorId: gap.monitorId }, '[Supervision] Failed to record observation gap');
    return false;
  }
}

export interface ObservationGapRecord extends ObservationGapPayload {
  createdAt: Date;
}

/**
 * Reads recorded observation gaps in a window, newest first.
 *
 * @param since - Window start / 集計開始時刻
 * @param limit - Max rows / 最大取得件数
 * @returns Parsed gap records / 解析済み欠落レコード
 */
export async function listObservationGaps(
  since: Date,
  limit = 500,
): Promise<ObservationGapRecord[]> {
  const { events } = await queryEvents({ eventType: 'supervision_observation_gap', since, limit });
  const records: ObservationGapRecord[] = [];
  for (const event of events) {
    const parsed = parseObservationGapPayload(event.payload);
    if (parsed) records.push({ ...parsed, createdAt: event.createdAt });
  }
  return records;
}

/** Identity of a gap for idempotent re-recording. */
function gapKey(monitorId: string, startAt: string, endAt: string): string {
  return `${monitorId}|${Date.parse(startAt)}|${Date.parse(endAt)}`;
}

export interface GapDetectionResult {
  gapDetected: boolean;
  recorded: number;
  /** Gaps found in the heartbeat stream whose record write failed this cycle. */
  unrecorded: number;
  gapMs: number;
  reasonKind: ObservationGapReasonKind | null;
}

/**
 * Re-scans the recent heartbeat stream and records every silence not yet in the
 * gap stream. Idempotent: a gap whose write failed earlier (or before a restart)
 * is found again on the next successful cycle instead of being lost when the
 * newest two samples move past it.
 *
 * @param monitorId - Monitor identity / モニター識別子
 * @param writeFailureTimes - In-process heartbeat write failures / 書込失敗時刻
 * @returns Detection outcome / 検出結果
 */
export async function detectAndRecordGap(
  monitorId: string = BACKEND_MONITOR_ID,
  writeFailureTimes: readonly Date[] = [],
): Promise<GapDetectionResult> {
  const { samples } = await readRecentHeartbeats(monitorId, GAP_RECONCILE_SAMPLES);
  const silences = findSilences(samples, writeFailureTimes);
  if (silences.length === 0) {
    return { gapDetected: false, recorded: 0, unrecorded: 0, gapMs: 0, reasonKind: null };
  }

  const oldest = silences[0].startAt;
  const known = new Set(
    (await listObservationGaps(oldest))
      .filter((g) => g.monitorId === monitorId)
      .map((g) => gapKey(g.monitorId, g.startAt, g.endAt)),
  );

  let recorded = 0;
  let unrecorded = 0;
  for (const gap of silences) {
    if (known.has(gapKey(monitorId, gap.startAt.toISOString(), gap.endAt.toISOString()))) continue;
    if (await recordObservationGap(gap)) {
      recorded += 1;
      log.warn(
        { monitorId, reasonKind: gap.reasonKind, note: gap.note },
        '[Supervision] Observation gap recorded',
      );
    } else {
      unrecorded += 1;
    }
  }

  const latest = silences[silences.length - 1];
  return {
    gapDetected: true,
    recorded,
    unrecorded,
    gapMs: latest.endAt.getTime() - latest.startAt.getTime(),
    reasonKind: latest.reasonKind,
  };
}

/**
 * Sums the observed-gap milliseconds overlapping a window.
 *
 * Overlapping gaps (recorded + reconstructed, or several monitors) are merged so
 * a stretch observed by nobody is subtracted once.
 *
 * @param gaps - Gap intervals / 欠落区間
 * @param windowStart - Window start / 窓の開始
 * @param windowEnd - Window end / 窓の終了
 * @returns Total gap milliseconds inside the window / 窓内の欠落合計ミリ秒
 */
export function sumGapMsWithin(
  gaps: ReadonlyArray<{ startAt: string | Date; endAt: string | Date }>,
  windowStart: Date,
  windowEnd: Date,
): number {
  const start = windowStart.getTime();
  const end = windowEnd.getTime();
  const toMs = (v: string | Date): number => (v instanceof Date ? v.getTime() : Date.parse(v));

  const clipped = gaps
    .map((g) => ({ from: Math.max(start, toMs(g.startAt)), to: Math.min(end, toMs(g.endAt)) }))
    .filter((r) => Number.isFinite(r.from) && Number.isFinite(r.to) && r.to > r.from)
    .sort((a, b) => a.from - b.from);

  let total = 0;
  let cursor = -Infinity;
  for (const range of clipped) {
    const from = Math.max(range.from, cursor);
    if (range.to > from) {
      total += range.to - from;
      cursor = range.to;
    }
  }
  return total;
}
