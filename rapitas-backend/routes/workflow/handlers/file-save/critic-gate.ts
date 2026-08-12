/**
 * FileSave Critic Gate
 *
 * Runs the research/plan phase-critic gate (judge panel) after the artifact and
 * its status transition are persisted, rolling the workflow back on a FAIL.
 * Not responsible for saving content or verify-phase gates.
 */

import { createLogger } from '../../../../config/logger';
import type { WorkflowFileType } from '../../core/workflow-helpers';

const log = createLogger('routes:workflow:handlers:files');

/**
 * Result of the critic-gate stage. `criticRejection` is populated when the gate
 * rejects this save — surfaced in the HTTP response so the saving agent's own
 * output (and thus the execution log a user watches) explains the rollback
 * instead of the agent reporting a plain "saved" while the status quietly
 * reverts underneath it.
 */
export interface CriticGateOutcome {
  newStatus?: string;
  criticRejection: {
    phase: 'research' | 'plan';
    rolledBackTo: string;
    reasons: string[];
    severity?: number;
  } | null;
}

/**
 * Applies the research/plan critic gate when the save advanced those phases.
 *
 * Research/plan critic gate (judge panel). After the artifact is saved and
 * its status persisted, run independent critic lenses; on a FAIL verdict the
 * artifact is archived and the workflow rolled back to regenerate it (bounded
 * self-repair, mirroring the verify gate). Changing newStatus to the rollback
 * target naturally skips the auto-split / auto-approve blocks downstream.
 * Default ON (R7 — plan-defect critique has ~90% recall pre-execution); opt out
 * via RAPITAS_PHASE_CRITIC=0. Lightweight-mode tasks skip it: they have no plan
 * phase, and trivial work must stay cheap. Fail-open when critics are down.
 *
 * @param params - taskId / fileType / current newStatus / content / workflow mode / 入力一式
 * @returns Possibly rolled-back newStatus and the rejection details (or null)
 */
export async function runPhaseCriticGate(params: {
  taskId: number;
  fileType: WorkflowFileType;
  newStatus: string | undefined;
  savedContent: string;
  workflowMode: string | null;
}): Promise<CriticGateOutcome> {
  const { taskId, fileType, savedContent, workflowMode } = params;
  let newStatus = params.newStatus;
  let criticRejection: CriticGateOutcome['criticRejection'] = null;

  if (
    workflowMode !== 'lightweight' &&
    ((fileType === 'research' && newStatus === 'research_done') ||
      (fileType === 'plan' && newStatus === 'plan_created'))
  ) {
    const { applyPhaseCriticGate } = await import('../../../../services/workflow/phase-critic');
    // NOTE: The critic runs LLM judges SYNCHRONOUSLY inside this request.
    // Unbounded, its wall time (observed 80-150s) exceeds the saving agent's
    // 120s curl timeout: the client resends, races itself, and if the dying
    // request carried the auto-approve tail the task stalls at plan_created
    // forever (task 492). Cap it below the client timeout and fail open —
    // matching this gate's stated fail-open philosophy; the reconciler's
    // healAutoApproveStalls pass is the backstop for anything still lost.
    const criticTimeoutMs = (() => {
      const v = parseInt(process.env.RAPITAS_PHASE_CRITIC_TIMEOUT_MS ?? '', 10);
      return Number.isFinite(v) && v > 0 ? v : 90_000;
    })();
    const gate = await Promise.race([
      applyPhaseCriticGate({
        taskId,
        phase: fileType === 'research' ? 'research' : 'plan',
        content: savedContent,
        currentStatus: newStatus,
      }),
      new Promise<{
        bounced: boolean;
        newStatus?: string;
        reasons?: string[];
        severity?: number;
      }>((resolve) =>
        setTimeout(() => {
          log.warn(
            { taskId, fileType, criticTimeoutMs },
            '[Workflow] Phase critic gate timed out — failing open',
          );
          resolve({ bounced: false });
        }, criticTimeoutMs),
      ),
    ]).catch(
      () =>
        ({ bounced: false }) as {
          bounced: boolean;
          newStatus?: string;
          reasons?: string[];
          severity?: number;
        },
    );
    if (gate.bounced && gate.newStatus) {
      newStatus = gate.newStatus;
      criticRejection = {
        phase: fileType as 'research' | 'plan',
        rolledBackTo: gate.newStatus,
        reasons: gate.reasons ?? [],
        severity: gate.severity,
      };
    }
  }

  return { newStatus, criticRejection };
}
