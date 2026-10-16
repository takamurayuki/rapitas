/**
 * Agent Usage Breakdown Role Helpers
 *
 * Normalization and canonical ordering for the workflow role dimension.
 * `normalizeRole`/`KNOWN_ROLE_ORDER` are also consumed directly by
 * utilization-query.ts (outside this module's own aggregation).
 */

/** Canonical display order for the workflow roles. Unknown roles sort after. */
export const KNOWN_ROLE_ORDER = [
  'researcher',
  'planner',
  'implementer',
  'verifier',
  'auto_verifier',
] as const;

/**
 * Normalize AgentSession.mode into a bare role name.
 *
 * @param mode - Raw session mode (e.g. "workflow-implementer") / セッションモード
 * @returns Role name without the "workflow-" prefix; 'other' for null / 役割名
 */
export function normalizeRole(mode: string | null | undefined): string {
  if (!mode) return 'other';
  return mode.startsWith('workflow-') ? mode.slice('workflow-'.length) : mode;
}

/**
 * Sort roles canonically: known workflow roles first (in pipeline order),
 * then unknown roles by descending cost.
 */
export function roleSortIndex(role: string): number {
  const idx = (KNOWN_ROLE_ORDER as readonly string[]).indexOf(role);
  return idx === -1 ? KNOWN_ROLE_ORDER.length : idx;
}
