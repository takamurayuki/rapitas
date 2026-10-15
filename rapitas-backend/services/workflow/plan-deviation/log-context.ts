/**
 * plan-deviation/log-context
 *
 * Returns the AgentExecutionLog lines around a deviation (by sequenceNumber),
 * clamped to the execution's real range and masked before they leave the
 * service. The DB access is injected so this module stays testable.
 */
import { maskDeviationText } from './deviation-mask';

/** Default lines shown before/after the target. */
export const DEFAULT_CONTEXT_LINES = 5;
/** Upper bound on before/after to keep responses small. */
export const MAX_CONTEXT_LINES = 20;

/** Minimal log row shape (AgentExecutionLog columns used here). */
export interface LogRow {
  sequenceNumber: number;
  logChunk: string;
}

/** Injected log access for one execution. */
export interface LogContextSource {
  /** Smallest and largest sequenceNumber, or null when the execution has no logs. */
  getBounds(): Promise<{ min: number; max: number } | null>;
  /** Rows with from ≤ sequenceNumber ≤ to, any order. */
  getRange(from: number, to: number): Promise<LogRow[]>;
}

/** One returned context line. */
export interface ContextLine {
  sequenceNumber: number;
  text: string;
  isTarget: boolean;
}

/**
 * Normalize a requested before/after count.
 *
 * @param value - Requested count (may be undefined / NaN) / 指定行数
 * @returns Integer in [0, MAX_CONTEXT_LINES], default 5 / 正規化した行数
 */
export function resolveContextWindow(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_CONTEXT_LINES;
  return Math.min(MAX_CONTEXT_LINES, Math.max(0, Math.trunc(value)));
}

/**
 * Fetch masked log lines around a target sequence number.
 *
 * @param source - Log access for the execution / ログ取得手段
 * @param query - Target seq and optional before/after counts / 対象seqと前後行数
 * @returns Lines in ascending sequence order, target flagged / 前後ログ行
 */
export async function fetchLogContext(
  source: LogContextSource,
  query: { seq: number; before?: number; after?: number },
): Promise<{ lines: ContextLine[] }> {
  const bounds = await source.getBounds();
  if (!bounds) return { lines: [] };
  const target = Math.min(bounds.max, Math.max(bounds.min, Math.trunc(query.seq)));
  const from = Math.max(bounds.min, target - resolveContextWindow(query.before));
  const to = Math.min(bounds.max, target + resolveContextWindow(query.after));
  const rows = await source.getRange(from, to);
  return {
    lines: [...rows]
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
      .map((r) => ({
        sequenceNumber: r.sequenceNumber,
        text: maskDeviationText(r.logChunk),
        isTarget: r.sequenceNumber === target,
      })),
  };
}
