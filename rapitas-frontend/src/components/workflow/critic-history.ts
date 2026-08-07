/**
 * criticHistory
 *
 * Converts raw `WorkflowTransition` rows into the display model for the
 * quality-critic gate history (bounces and budget-exhausted pass-throughs)
 * shown in the task-detail workflow section. NOT responsible for fetching
 * or rendering — pure data transformation only.
 */

/** Shape of one row from GET /workflow/tasks/:taskId/transitions. */
export interface RawWorkflowTransition {
  id?: number | string | null;
  cause?: string | null;
  phase?: string | null;
  metadata?: {
    reasons?: unknown;
    severity?: unknown;
  } | null;
  createdAt?: string | null;
}

export type CriticGatePhase = 'research' | 'plan';

/** 'bounced' = critic rejected and rolled back; 'exhausted' = bounce budget ran out and the artifact passed through unreviewed. */
export type CriticGateEntryType = 'bounced' | 'exhausted';

/** One critic-gate event, ready for display (newest last — API order is createdAt asc). */
export interface CriticGateHistoryEntry {
  id: string;
  phase: CriticGatePhase;
  type: CriticGateEntryType;
  severity: number | null;
  reasons: string[];
  createdAt: string | null;
}

// The only four causes phase-critic-gate.ts records (recordTransition call
// sites) — anything else in the transition log is not a critic-gate event.
const CRITIC_CAUSE_MAP: Record<string, { phase: CriticGatePhase; type: CriticGateEntryType }> = {
  research_critic_failed: { phase: 'research', type: 'bounced' },
  plan_critic_failed: { phase: 'plan', type: 'bounced' },
  research_critic_exhausted: { phase: 'research', type: 'exhausted' },
  plan_critic_exhausted: { phase: 'plan', type: 'exhausted' },
};

/**
 * Buckets a critic severity score into the same visual tiers as the
 * transient rejection banner in TaskWorkflowSection (severityStyle).
 *
 * @param severity - Critic severity score, or null when absent/non-numeric / 批評の重大度スコア
 * @returns 'high' (>= 80), 'medium' (>= 50), 'low' (below 50), or null for null input / 重大度の区分
 */
export function severityBucket(severity: number | null): 'high' | 'medium' | 'low' | null {
  if (severity == null) return null;
  if (severity >= 80) return 'high';
  if (severity >= 50) return 'medium';
  return 'low';
}

/**
 * Filters a task's transition log down to critic-gate events and normalizes
 * each into a display entry, defending against malformed metadata (legacy
 * rows may lack reasons/severity or hold unexpected types).
 *
 * @param transitions - Rows from GET /workflow/tasks/:taskId/transitions, createdAt asc / 遷移ログの行
 * @returns Critic-gate entries in the input (chronological) order / 表示用エントリ
 */
export function deriveCriticGateHistory(
  transitions: RawWorkflowTransition[],
): CriticGateHistoryEntry[] {
  const entries: CriticGateHistoryEntry[] = [];
  transitions.forEach((row, index) => {
    const mapped = row.cause ? CRITIC_CAUSE_MAP[row.cause] : undefined;
    if (!mapped) return;
    // row.phase is authoritative when valid; the cause prefix is a fallback
    // for out-of-contract rows (see plan: phase is set by recordTransition).
    const phase: CriticGatePhase =
      row.phase === 'research' || row.phase === 'plan' ? row.phase : mapped.phase;
    const reasons = Array.isArray(row.metadata?.reasons)
      ? row.metadata.reasons.filter((r): r is string => typeof r === 'string')
      : [];
    const severity = typeof row.metadata?.severity === 'number' ? row.metadata.severity : null;
    entries.push({
      id: `critic-${row.id ?? index}`,
      phase,
      type: mapped.type,
      severity,
      reasons,
      createdAt: row.createdAt ?? null,
    });
  });
  return entries;
}
