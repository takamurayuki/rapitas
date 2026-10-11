/**
 * worker-restart-log
 *
 * Append-only NDJSON record of agent-worker restarts, the one worker-health
 * metric that previously existed only as a log line. Not responsible for
 * detecting restarts (lifecycle.ts) or for aggregation (worker-health-query.ts).
 *
 * File layout: the first line is `{"type":"recording_started","at":ISO}` so a
 * time before recording began can be told apart from "zero restarts"; every
 * later line is `{"type":"restart","at":ISO}`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

/** Parsed restart log. */
export interface WorkerRestartLog {
  /** null when recording has never started (no file). */
  recordingStartedAt: Date | null;
  restarts: Date[];
}

/**
 * Default file path; shares RAPITAS_DATA_DIR with the cycle-event logger.
 *
 * @returns Absolute path of worker-restarts.ndjson / 再起動ログのパス
 */
export function getWorkerRestartLogPath(): string {
  const override = process.env.RAPITAS_DATA_DIR;
  const base = override && override.trim().length > 0 ? override : join(homedir(), '.rapitas');
  return join(base, 'logs', 'worker-restarts.ndjson');
}

function appendLine(filePath: string, record: { type: string; at: string }): void {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * Write the recordingStartedAt marker if the file does not exist yet.
 * Must run at backend start, not on the first restart: otherwise a healthy
 * worker would leave the restart metric "unknown" indefinitely.
 *
 * @param now - Timestamp (injectable) / 記録開始時刻
 * @param filePath - Override for tests / テスト用パス
 */
export function ensureRestartRecordingStarted(
  now: Date = new Date(),
  filePath: string = getWorkerRestartLogPath(),
): void {
  if (existsSync(filePath)) return;
  appendLine(filePath, { type: 'recording_started', at: now.toISOString() });
}

/**
 * Record one worker restart. Throws on I/O failure; callers on the restart
 * path must catch so a logging problem cannot block recovery.
 *
 * @param now - Timestamp (injectable) / 再起動時刻
 * @param filePath - Override for tests / テスト用パス
 */
export function appendWorkerRestart(
  now: Date = new Date(),
  filePath: string = getWorkerRestartLogPath(),
): void {
  ensureRestartRecordingStarted(now, filePath);
  appendLine(filePath, { type: 'restart', at: now.toISOString() });
}

/**
 * Read and parse the restart log. Malformed lines are skipped.
 *
 * @param filePath - Override for tests / テスト用パス
 * @returns Parsed log; recordingStartedAt is null when the file is missing / パース結果
 */
export function readWorkerRestartLog(
  filePath: string = getWorkerRestartLogPath(),
): WorkerRestartLog {
  const log: WorkerRestartLog = { recordingStartedAt: null, restarts: [] };
  if (!existsSync(filePath)) return log;
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as { type?: string; at?: string };
      const at = rec.at ? new Date(rec.at) : null;
      if (!at || Number.isNaN(at.getTime())) continue;
      if (rec.type === 'recording_started') {
        if (!log.recordingStartedAt || at < log.recordingStartedAt) log.recordingStartedAt = at;
      } else if (rec.type === 'restart') {
        log.restarts.push(at);
      }
    } catch {
      // Skip a torn/garbled line rather than lose the whole history.
    }
  }
  return log;
}

/**
 * Count restarts within [start, end).
 *
 * @param log - Parsed log / パース済みログ
 * @param start - Inclusive start / 開始
 * @param end - Exclusive end / 終了
 * @returns Count, or null when the range begins before recording started (unknown, not 0)
 */
export function countRestartsInRange(log: WorkerRestartLog, start: Date, end: Date): number | null {
  if (!log.recordingStartedAt || start < log.recordingStartedAt) return null;
  return log.restarts.filter((t) => t >= start && t < end).length;
}

/**
 * Record a restart without ever throwing, for use on the crash-recovery path.
 *
 * @param now - Timestamp (injectable) / 再起動時刻
 * @param filePath - Override for tests / テスト用パス
 * @returns false if the write failed / 書き込み成否
 */
export function recordWorkerRestartSafely(
  now: Date = new Date(),
  filePath: string = getWorkerRestartLogPath(),
): boolean {
  try {
    appendWorkerRestart(now, filePath);
    return true;
  } catch {
    // NOTE: a logging failure must not delay worker recovery; the metric just misses one event.
    return false;
  }
}
