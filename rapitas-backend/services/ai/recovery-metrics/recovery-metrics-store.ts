/**
 * recovery-metrics-store
 *
 * JSONL persistence for recovery attempt records. Lives in RAPITAS_DATA_DIR
 * (default ~/.rapitas) because prisma schema changes force a server restart —
 * same mechanism as experiment-store. Pure I/O: no aggregation, no policy.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import type { RecoveryAttemptRecord } from './recovery-metrics.types';

function dataDir(): string {
  return process.env.RAPITAS_DATA_DIR?.trim() || join(homedir(), '.rapitas');
}

/** Absolute path of the attempts JSONL (resolved per call so tests can redirect via env). */
export function attemptsFilePath(): string {
  return join(dataDir(), 'recovery-metrics', 'attempts.jsonl');
}

/** Minimal shape check so a hand-edited/corrupt line degrades to a skip. */
function isAttemptRecord(value: unknown): value is RecoveryAttemptRecord {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Partial<RecoveryAttemptRecord>;
  return (
    typeof v.tsMs === 'number' &&
    typeof v.errorType === 'string' &&
    typeof v.strategy === 'string' &&
    typeof v.outcome === 'string'
  );
}

/**
 * Append one attempt record as a JSONL line, creating the directory on first
 * use. I/O failures propagate — the recorder above is the never-throw layer.
 *
 * @param record - Attempt record to persist. / 保存する試行レコード
 */
export function appendRecord(record: RecoveryAttemptRecord): void {
  const file = attemptsFilePath();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}

/**
 * Read attempt records, skipping malformed lines (best-effort; empty array on
 * any read failure — a corrupt store must never 500 the metrics API).
 *
 * @param sinceMs - Only return records with tsMs >= sinceMs when given. / この時刻以降のみ返す
 * @returns Parsed records in file order. / ファイル順のレコード
 */
export function readRecords(sinceMs?: number): RecoveryAttemptRecord[] {
  try {
    const lines = readFileSync(attemptsFilePath(), 'utf8').split('\n');
    const records: RecoveryAttemptRecord[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isAttemptRecord(parsed)) continue;
        if (sinceMs !== undefined && parsed.tsMs < sinceMs) continue;
        records.push(parsed);
      } catch {
        continue;
      }
    }
    return records;
  } catch {
    return [];
  }
}
