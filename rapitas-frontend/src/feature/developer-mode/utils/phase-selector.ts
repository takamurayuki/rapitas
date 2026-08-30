/**
 * phase-selector
 *
 * Maps an AgentSession.mode value to the phase-timeline section it belongs
 * to. Mirrors the backend's services/workflow/phase-segmentation.ts mapping
 * (task #785) — kept in sync manually since frontend/backend don't share a
 * types package.
 */

export const PHASE_ORDER = ['research', 'plan', 'implement', 'verify'] as const;

export type PhaseType = (typeof PHASE_ORDER)[number];

const SESSION_MODE_TO_PHASE: Record<string, PhaseType> = {
  'workflow-researcher': 'research',
  'workflow-planner': 'plan',
  'workflow-implementer': 'implement',
  'workflow-verifier': 'verify',
  'workflow-auto_verifier': 'verify',
};

/**
 * Maps an `AgentSession.mode` value to the timeline phase it belongs to.
 *
 * @param sessionMode - `AgentSession.mode` (e.g. `"workflow-implementer"`), or null/undefined for non-workflow runs / セッションモード
 * @returns The phase this session's executions belong to, or null when unrecognized / 該当フェーズ、不明な場合は null
 */
export function selectPhaseType(sessionMode: string | null | undefined): PhaseType | null {
  if (!sessionMode) return null;
  return SESSION_MODE_TO_PHASE[sessionMode] ?? null;
}
