/**
 * Artifact Reuse Reconciler
 *
 * Fast-forwards a task's workflowStatus past phases whose artifacts
 * (research.md / plan.md) already exist on disk and are good enough quality
 * to reuse, so a stale/reset workflowStatus doesn't waste a redundant
 * research or plan pass before the next role is dispatched. Mirrors the
 * existing REACTIVE fast-forward in workflow-handlers-files.ts (which only
 * fires when a file save is rejected at draft status) but runs proactively,
 * right before role dispatch — see workflow-orchestrator.ts.
 *
 * Deliberately never touches verify.md: a stale verify.md must always be
 * re-validated against the CURRENT diff, never assumed reusable.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { resolveWorkflowDir, readWorkflowFile } from './workflow-file-utils';
import { isReusableArtifact } from './phase-output-validator';
import { recordTransition } from './transition-recorder';
import type { WorkflowStatus } from './workflow-types';

const log = createLogger('artifact-reuse-reconciler');

export interface ArtifactReconcileResult {
  /** The status to use for the rest of this dispatch (advanced or unchanged). */
  status: WorkflowStatus;
  /** True when workflowStatus was actually advanced (and persisted). */
  advanced: boolean;
}

/**
 * Checks research.md/plan.md against the task's current status and advances
 * workflowStatus to the furthest status their existing, reusable content
 * justifies. Only applies at `draft` and `research_done` — those are the
 * only statuses where a research/plan phase is still pending. Never advances
 * past `plan_created`: review/approval still governs from there, exactly as
 * it would for a freshly-produced plan.md.
 *
 * @param taskId - Task to reconcile. / 対象タスク
 * @param currentStatus - Task's current workflowStatus. / 現在のワークフローステータス
 * @param includePlan - Whether this task's workflow mode has a plan phase (false for lightweight). / このモードに計画フェーズがあるか
 * @returns The status to dispatch against, and whether it was advanced. / 表示ステータスと前進の有無
 */
export async function reconcileStatusFromExistingArtifacts(
  taskId: number,
  currentStatus: WorkflowStatus,
  includePlan: boolean,
): Promise<ArtifactReconcileResult> {
  if (currentStatus !== 'draft' && currentStatus !== 'research_done') {
    return { status: currentStatus, advanced: false };
  }

  const resolved = await resolveWorkflowDir(taskId).catch(() => null);
  if (!resolved) return { status: currentStatus, advanced: false };

  let target: WorkflowStatus = currentStatus;

  if (target === 'draft') {
    const research = await readWorkflowFile(resolved.dir, 'research').catch(() => null);
    const researchReusable = !!research && isReusableArtifact('research', research);
    if (!researchReusable) return { status: currentStatus, advanced: false };
    target = 'research_done';
  }

  if (includePlan && target === 'research_done') {
    const plan = await readWorkflowFile(resolved.dir, 'plan').catch(() => null);
    const planReusable = !!plan && isReusableArtifact('plan', plan);
    if (planReusable) target = 'plan_created';
  }

  if (target === currentStatus) {
    return { status: currentStatus, advanced: false };
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { workflowStatus: target, updatedAt: new Date() },
  });
  await recordTransition({
    taskId,
    fromStatus: currentStatus,
    toStatus: target,
    actor: 'system',
    cause: 'artifact_reuse_fastforward',
    phase: target === 'plan_created' ? 'plan' : 'research',
    metadata: { trigger: 'pre_dispatch_reconciliation' },
  }).catch(() => {});
  log.info(
    { taskId, from: currentStatus, to: target },
    '[ArtifactReuseReconciler] Fast-forwarded workflowStatus from existing reusable artifacts',
  );
  return { status: target, advanced: true };
}
