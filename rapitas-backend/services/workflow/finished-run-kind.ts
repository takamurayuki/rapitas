/**
 * finished-run-kind
 *
 * Decides whether a finished agent run is certainly a single-shot run (not a
 * workflow phase), for the completion writes that treat the two differently
 * (status sync, post-execution review). Not responsible for the completion
 * check itself — see verifier-completion-check.ts.
 */
import { resolveEffectiveWorkflowDisabled } from './workflow-disabled';

/**
 * What the caller knows about the run that just finished. `sessionMode` is the
 * AgentSession.mode ('workflow-researcher' etc. for a workflow phase run);
 * `null` means the session has no mode, `undefined` that the caller could not
 * read it.
 */
export interface FinishedRunInfo {
  sessionMode: string | null | undefined;
}

/**
 * Whether the finished run is certainly NOT a workflow phase run. A missing
 * or unreadable mode proves nothing — execute-route used to keep running a
 * workflow phase when tagging its session failed, leaving mode null — so only
 * a workflow that is disabled for the task (task flag or global setting)
 * makes a run single-shot. A workflow-* mode is always a workflow run.
 *
 * @param taskId - Task the run belonged to / 実行対象のタスクID
 * @param sessionMode - AgentSession.mode of the run, null/undefined if none or unread / 実行のセッション種別
 * @returns True only when the run is certainly single-shot / 単発実行と確定できる場合のみ true
 */
export async function isCertainlySingleShotRun(
  taskId: number,
  sessionMode: string | null | undefined,
): Promise<boolean> {
  if (sessionMode?.startsWith('workflow-')) return false;
  // NOTE: resolveEffectiveWorkflowDisabled fails open to false on a read
  // error, which here means "not certain" — the safe direction.
  return resolveEffectiveWorkflowDisabled(taskId);
}
