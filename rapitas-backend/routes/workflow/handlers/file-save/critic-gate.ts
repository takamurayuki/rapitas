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
  } else if (fileType === 'research' || fileType === 'plan') {
    // NOTE: warn, and only for the two artifacts this gate exists to judge
    // (#1303). A verify or question save is not a skip — it is none of this
    // gate's business — but a research.md or plan.md that reached the save
    // path WITHOUT being judged is the gate losing its only chance at that
    // artifact, which is a problem the daily log-health job should see.
    //
    // This line exists because the question "did the critic run?" was
    // unanswerable. Every outcome the gate records is a FAILURE — a rejection
    // writes a `<phase>_critic_failed` transition, a timeout and an error warn
    // — while a pass logs one `log.info` in phase-critic.ts, and
    // config/logger.ts persists warn and above only. So a gate that passed and
    // a gate that never ran look identical on disk, and criticFirstPass reads
    // null either way.
    //
    // `newStatus` is the discriminator: it is set only by the save that
    // ADVANCES the status (status-transition.ts), and the `file_saved:<type>`
    // transition the metric counts lives behind the same condition. Recording
    // it here says which of the two conditions declined the gate.
    log.warn(
      {
        taskId,
        fileType,
        newStatus: newStatus ?? null,
        workflowMode,
        reason: workflowMode === 'lightweight' ? 'lightweight_mode' : 'status_not_advanced',
      },
      '[phase-critic-gate] artifact saved without being judged',
    );
  }

  return { newStatus, criticRejection };
}
