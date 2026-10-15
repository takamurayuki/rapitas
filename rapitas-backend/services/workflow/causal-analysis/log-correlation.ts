/**
 * log-correlation
 *
 * Time-correlates queue-stall WARN log entries with a root-cause candidate's cascade window,
 * as corroborating evidence. The log lines carry no taskId (the parsed entry keeps only
 * name/msg/time), so this is a temporal signal only; it never decides the root by itself.
 */
import { CAUSAL_WINDOW_MS, type RootCauseCandidate } from './root-cause-detector';

/** Minimal log-entry shape (compatible with ParsedLogEntry). */
export interface LogSignalEntry {
  msg: string;
  time?: number;
}

/** WARN streams that indicate a stalled or contended queue. */
const QUEUE_STALL_SIGNALS = [
  /Slow queue processing/i,
  /Execution result ignored after cancellation/i,
];

/**
 * Counts queue-stall WARN entries inside [onset, onset + CAUSAL_WINDOW_MS].
 *
 * @param candidate - Root-cause candidate whose window is checked. / 根因候補
 * @param entries - Parsed log entries (today's global backend log). / 解析済みログ
 * @returns Number of corroborating WARN entries. / 裏付けとなるWARN件数
 */
export function countCorroboratingLogSignals(
  candidate: Pick<RootCauseCandidate, 'onsetMs'>,
  entries: LogSignalEntry[],
): number {
  const end = candidate.onsetMs + CAUSAL_WINDOW_MS;
  return entries.filter(
    (e) =>
      e.time !== undefined &&
      e.time >= candidate.onsetMs &&
      e.time <= end &&
      QUEUE_STALL_SIGNALS.some((re) => re.test(e.msg)),
  ).length;
}
