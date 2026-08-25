/**
 * decision-ledger/from-decision-trace
 *
 * Projects `AgentDecisionTrace` rows into the shared `Decision` shape. Read-only:
 * the consistency checker owns the verdict, this only translates it.
 */

import type { Decision, DecisionKind, DecisionVerdict } from './types';

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
 * The decision kind is encoded in the nodeKey's middle segment
 * (`task658:model-route:<ts>`), which is the only place it is recorded.
 */
const KIND_BY_NODE_SEGMENT: Record<string, DecisionKind> = {
  'model-route': 'model_tier',
  // A provider fallback re-picks the model after a cooldown, so it belongs with
  // the other model choices rather than in a category of its own.
  'provider-fallback': 'model_tier',
  'risk-floor': 'risk_floor',
  escalation: 'escalation',
  'knowledge-recall': 'knowledge_use',
};

/**
 * Read the decision kind out of a nodeKey.
 *
 * @param nodeKey - e.g. "task658:model-route:1787672867337". / ノードキー
 * @returns The kind, defaulting to model_tier for the historical rows that
 *   predate any other kind. / 種別（旧行は model_tier 既定）
 */
export function kindFromNodeKey(nodeKey: string): DecisionKind {
  const segment = nodeKey.split(':')[1] ?? '';
  return KIND_BY_NODE_SEGMENT[segment] ?? 'model_tier';
}

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
