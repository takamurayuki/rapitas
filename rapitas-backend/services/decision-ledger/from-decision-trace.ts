/**
 * decision-ledger/from-decision-trace
 *
 * Projects `AgentDecisionTrace` rows into the shared `Decision` shape. Read-only:
 * the consistency checker owns the verdict, this only translates it.
 */

import { kindFromNodeKey } from '../observability/decision-trace/node-key';
import type { Decision, DecisionVerdict } from './types';

/** The `AgentDecisionTrace` columns this projection reads. */
export interface DecisionTraceRow {
  id: number;
  taskId: number | null;
  nodeKey: string;
  summary: string;
  adoptedId: string;
  adoptedReason: string;
  consistency: string;
  consistencyNote: string | null;
  createdAt: Date;
  costUsd?: number | null;
  /** Masked JSON of the decision's inputs; carries role and tier when present. */
  inputMasked?: string | null;
}

/**
 * `consistency` is a binary plus a catch-all, so the mapping is deliberately
 * lossy in one place: `skipped` means both "not applicable" and "could not be
 * judged", and both are honestly `indeterminate` here. Anything unrecognised
 * stays `pending` rather than being counted as a judgement that never happened.
 */
const VERDICT_BY_CONSISTENCY: Record<string, DecisionVerdict> = {
  consistent: 'correct',
  inconsistent: 'wrong',
  skipped: 'indeterminate',
  pending: 'pending',
};

/**
 * Pull the role and tier out of the masked input JSON.
 *
 * Both are absent on rows recorded before they were wired in, so every field is
 * optional and a parse failure yields nothing rather than throwing — a
 * malformed audit row must not break the read path over the whole ledger.
 */
function readInput(inputMasked: string | null | undefined): { role?: string; tier?: string } {
  if (!inputMasked) return {};
  try {
    const parsed: unknown = JSON.parse(inputMasked);
    if (!parsed || typeof parsed !== 'object') return {};
    const o = parsed as { role?: unknown; tier?: unknown };
    return {
      ...(typeof o.role === 'string' ? { role: o.role } : {}),
      ...(typeof o.tier === 'string' ? { tier: o.tier } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Project one trace row.
 *
 * @param row - Raw `AgentDecisionTrace` row. / 生の決定トレース行
 * @returns The normalized decision. / 正規化された決定
 */
export function fromDecisionTrace(row: DecisionTraceRow): Decision {
  const { role, tier } = readInput(row.inputMasked);
  return {
    id: `trace:${row.id}`,
    at: row.createdAt,
    taskId: row.taskId,
    kind: kindFromNodeKey(row.nodeKey),
    // The role is what the decision was ABOUT; the summary only says what was
    // picked. Rows predating the role falling back to the summary keeps them
    // readable instead of collapsing them all onto one blank subject.
    subject: role ? `${role} phase` : row.summary,
    predicted: { adopted: row.adoptedId, ...(tier ? { tier } : {}), ...(role ? { role } : {}) },
    basis: row.adoptedReason,
    outcome: row.consistencyNote ? { note: row.consistencyNote } : null,
    verdict: VERDICT_BY_CONSISTENCY[row.consistency] ?? 'pending',
    costUsd: typeof row.costUsd === 'number' ? row.costUsd : 0,
    source: 'decision_trace',
  };
}
