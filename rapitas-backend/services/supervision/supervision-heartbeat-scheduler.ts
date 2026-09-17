/**
 * SupervisionHeartbeatScheduler
 *
 * Emits the backend's own liveness sample on a fixed interval and, right after
 * each sample, asks the gap detector whether the preceding silence was too long.
 * This makes the monitor's own uptime observable instead of assumed — the
 * failure mode that produced the 2026-09-09 observation blackout.
 * Not responsible for judging acceptance — see acceptance-status-service.ts.
 */
import { createLogger } from '../../config/logger';
import { appendEvent } from '../memory/timeline';
import { refreshAcceptanceSnapshot } from './acceptance-status-service';
import { detectAndRecordGap } from './observation-gap-detector';
import {
  BACKEND_MONITOR_ID,
  SUPERVISION_SCHEMA_VERSION,
  monitorCorrelationId,
  type MonitorHeartbeatPayload,
} from './supervision-events';

const logger = createLogger('supervision-heartbeat-scheduler');

/** 1 min — matches the external monitor's sampling cadence. */
const DEFAULT_INTERVAL_MS = 60 * 1000;

/** Acceptance snapshot is recomputed every N heartbeat cycles (~5 min). */
const SNAPSHOT_EVERY_CYCLES = 5;

/**
 * Heartbeat write failures seen by this process, used as evidence when the next
 * successful sample classifies the silence. Bounded to the reconcile window.
 */
const writeFailureTimes: Date[] = [];
const MAX_TRACKED_WRITE_FAILURES = 120;

/**
 * Resolves the heartbeat interval from the environment.
 *
 * @returns Interval in milliseconds / ハートビート間隔（ミリ秒）
 */
function resolveIntervalMs(): number {
  const raw = process.env.RAPITAS_SUPERVISION_HEARTBEAT_INTERVAL_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
}

/**
 * Writes one heartbeat sample and checks the interval that preceded it.
 *
 * @param intervalMs - The cadence this monitor promises / このモニターの周期
 * @param monitorId - Monitor identity / モニター識別子
 * @param source - Who is sampling; external monitors report their own pid / 送信元
 * @returns true when the heartbeat was persisted / 永続化できたら true
 */
export async function emitHeartbeat(
  intervalMs: number,
  monitorId: string = BACKEND_MONITOR_ID,
  source: { sourceKind: MonitorHeartbeatPayload['sourceKind']; pid: number | null } = {
    sourceKind: 'backend_timer',
    pid: process.pid,
  },
): Promise<boolean> {
  const payload: MonitorHeartbeatPayload = {
    schemaVersion: SUPERVISION_SCHEMA_VERSION,
    monitorId,
    sourceKind: source.sourceKind,
    intervalMs,
    pid: source.pid,
    status: 'alive',
  };

  try {
    await appendEvent({
      eventType: 'supervision_monitor_heartbeat',
      actorType: 'system',
      actorId: monitorId,
      payload: payload as unknown as Record<string, unknown>,
      correlationId: monitorCorrelationId(monitorId),
    });
  } catch (err) {
    // Deliberately swallowed: killing the scheduler on a write error would
    // extend the very blackout this module exists to detect. The missed sample
    // becomes a gap once the next write succeeds.
    logger.error({ err, monitorId }, '[SupervisionHeartbeatScheduler] Heartbeat write failed');
    if (source.sourceKind === 'backend_timer') {
      writeFailureTimes.push(new Date());
      if (writeFailureTimes.length > MAX_TRACKED_WRITE_FAILURES) writeFailureTimes.shift();
    }
    return false;
  }

  try {
    await detectAndRecordGap(
      monitorId,
      source.sourceKind === 'backend_timer' ? writeFailureTimes : [],
    );
  } catch (err) {
    logger.warn({ err, monitorId }, '[SupervisionHeartbeatScheduler] Gap detection failed');
  }
  return true;
}

export class SupervisionHeartbeatScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private intervalMs = DEFAULT_INTERVAL_MS;
  private cycle = 0;

  /**
   * Start emitting heartbeats.
   *
   * @param intervalMs - Interval in milliseconds (defaults to env / 1 min) / 間隔（ミリ秒）
   */
  start(intervalMs?: number): void {
    if (this.isRunning) {
      logger.warn('[SupervisionHeartbeatScheduler] Already running, ignoring start request');
      return;
    }

    this.intervalMs = intervalMs ?? resolveIntervalMs();
    logger.info(`[SupervisionHeartbeatScheduler] Starting with ${this.intervalMs}ms interval`);
    this.isRunning = true;

    // Immediate first sample: this is what reconstructs the downtime window
    // between the previous process's last heartbeat and this restart.
    void this.runOnce();

    this.intervalId = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
  }

  /** Stop emitting heartbeats. */
  stop(): void {
    if (!this.isRunning) return;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('[SupervisionHeartbeatScheduler] Stopped');
  }

  /**
   * Whether the scheduler is currently running.
   *
   * @returns True if running / 実行中なら true
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /** Runs one heartbeat cycle; never rejects, so a bad cycle cannot stop the timer. */
  async runOnce(): Promise<void> {
    try {
      await emitHeartbeat(this.intervalMs);
    } catch (err) {
      logger.error({ err }, '[SupervisionHeartbeatScheduler] Heartbeat cycle failed');
    }
    // First cycle included so a restart publishes a fresh verdict immediately.
    const snapshotDue = this.cycle % SNAPSHOT_EVERY_CYCLES === 0;
    this.cycle += 1;
    if (!snapshotDue) return;
    try {
      await refreshAcceptanceSnapshot({ heartbeatIntervalMs: this.intervalMs });
    } catch (err) {
      logger.error({ err }, '[SupervisionHeartbeatScheduler] Acceptance snapshot cycle failed');
    }
  }
}

let globalScheduler: SupervisionHeartbeatScheduler | null = null;

/**
 * Get the global supervision heartbeat scheduler.
 *
 * @returns Global scheduler instance / グローバルスケジューラ
 */
export function getSupervisionHeartbeatScheduler(): SupervisionHeartbeatScheduler {
  if (!globalScheduler) {
    globalScheduler = new SupervisionHeartbeatScheduler();
  }
  return globalScheduler;
}

/**
 * Start the global supervision heartbeat scheduler.
 *
 * @param intervalMs - Optional interval in milliseconds / オプションの間隔（ミリ秒）
 */
export function startSupervisionHeartbeatScheduler(intervalMs?: number): void {
  getSupervisionHeartbeatScheduler().start(intervalMs);
}

/** Stop the global supervision heartbeat scheduler. */
export function stopSupervisionHeartbeatScheduler(): void {
  getSupervisionHeartbeatScheduler().stop();
}
