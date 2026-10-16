/**
 * probe-metrics-recorder
 *
 * The single write entry point for probe attempt records. Never throws:
 * measurement is a side feature and a recording failure must not propagate
 * into the preflight probe stage it observes (every phase transition passes
 * there).
 */
import { appendRecord } from './probe-metrics-store';
import type { ProbeAttemptRecord } from './probe-metrics.types';
import { createLogger } from '../../../config/logger';

const log = createLogger('ai:probe-metrics');

/**
 * Appends a probe attempt record to the JSONL store.
 * Same NODE_ENV=test guard as recovery-metrics-recorder — existing regression
 * suites drive the real probe path, and their attempts would otherwise
 * pollute the developer's live metrics store.
 *
 * @param record - Full attempt record (tsMs injected by the caller). / 記録する試行結果
 */
export function recordProbeAttempt(record: ProbeAttemptRecord): void {
  if (process.env.NODE_ENV === 'test' && !process.env.RAPITAS_DATA_DIR) return;
  try {
    appendRecord(record);
  } catch (err) {
    log.warn({ err }, 'Failed to record probe attempt (metrics only — probe result unaffected)');
  }
}
