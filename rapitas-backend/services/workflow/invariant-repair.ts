/**
 * invariant-repair
 *
 * Per-violation-code self-repair for `checkWorkflowInvariants` (task 766).
 * `status_mismatch` (workflow-reconciler.ts `healCompletedDesync`) and
 * `incomplete_subtasks` (subtask-completion-handler.ts) already self-heal via
 * independent existing paths — this module covers the one code with no
 * repair path at all: `missing_file`. Not responsible for the non-convergence
 * escalation/blocking decision (see verify-invariant-repair.ts).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { ACTIVE_EXEC } from './workflow-reconciler-requeue';
import {
  normalizeWorkflowStatus,
  requiredWorkflowFiles,
  resolveIncludePlan,
  type Violation,
} from './workflow-invariants';
import { WORKFLOW_STATUSES, type WorkflowStatus } from './workflow-types';

const log = createLogger('workflow:invariant-repair');

/**
 * Statuses whose required-file set differs from the one immediately before
 * it — the only points a `missing_file` rollback can land on safely. The
 * other statuses (plan_approved / in_progress) share plan_created's file
 * requirement, so rolling back onto them would not resolve the violation.
 */
const CHECKPOINT_STATUSES: readonly WorkflowStatus[] = [
  'research_done',
  'plan_created',
  'verify_done',
];

export interface MissingFileRepairResult {
  repaired: boolean;
  reason?: string;
  newStatus?: WorkflowStatus;
}

/** Strips the `.md` suffix to match a required-file display name to its WorkflowFile.fileType. */
function fileTypeOf(fileName: string): string {
  return fileName.replace(/\.md$/, '');
}

/**
 * Repairs a `missing_file` violation by rolling `task.workflowStatus` back to
 * the nearest earlier checkpoint whose required artifacts are all present.
 * Only repairs when unambiguous: every file required beyond that checkpoint
 * must be entirely absent (any partial presence means the user has already
 * moved past it, so a rollback would be destructive — task 766 plan.md
 * "エッジケースの方針"), and no execution is currently in flight for the task.
 * Anything else is left alone for the non-convergence escalation to catch
 * (see verify-invariant-repair.ts attemptInvariantCutoff).
 *
 * @param taskId - Task the violation was detected on. / 対象タスク
 * @param violation - The `missing_file` Violation from checkWorkflowInvariants. / 検出済みの違反
 * @returns Repair verdict; `repaired:false` always includes a `reason`. / 修復結果
 */
export async function repairMissingFile(
  taskId: number,
  violation: Violation,
): Promise<MissingFileRepairResult> {
  if (violation.code !== 'missing_file') {
    return { repaired: false, reason: 'not_missing_file_code' };
  }

  const task = await prisma.task
    .findUnique({ where: { id: taskId }, select: { workflowStatus: true, workflowMode: true } })
    .catch(() => null);
  if (!task) return { repaired: false, reason: 'task_not_found' };

  const wf = normalizeWorkflowStatus(task.workflowStatus);
  const includePlan = await resolveIncludePlan(task.workflowMode, wf);
  const required = requiredWorkflowFiles(wf, includePlan);
  if (required.length === 0) return { repaired: false, reason: 'no_required_files' };

  const present = await prisma.workflowFile
    .findMany({ where: { taskId }, select: { fileType: true } })
    .catch(() => [] as { fileType: string }[]);
  const presentTypes = new Set(present.map((f) => f.fileType));

  const currentRank = WORKFLOW_STATUSES.indexOf(wf);
  let target: WorkflowStatus | null = null;
  for (const checkpoint of CHECKPOINT_STATUSES) {
    if (WORKFLOW_STATUSES.indexOf(checkpoint) >= currentRank) break;
    const checkpointRequired = requiredWorkflowFiles(checkpoint, includePlan);
    const allPresent = checkpointRequired.every((f) => presentTypes.has(fileTypeOf(f)));
    if (allPresent) target = checkpoint;
  }
  if (!target) return { repaired: false, reason: 'no_safe_checkpoint' };

  const targetRequired = new Set(requiredWorkflowFiles(target, includePlan));
  const beyondTarget = required.filter((f) => !targetRequired.has(f));
  const anyBeyondPresent = beyondTarget.some((f) => presentTypes.has(fileTypeOf(f)));
  if (anyBeyondPresent) return { repaired: false, reason: 'files_exist_beyond_checkpoint' };

  const liveExec = await prisma.agentExecution
    .findFirst({
      where: { session: { config: { taskId } }, status: { in: ACTIVE_EXEC } },
      select: { id: true },
    })
    .catch(() => null);
  if (liveExec) return { repaired: false, reason: 'live_execution_in_progress' };

  const updated = await prisma.task
    .update({ where: { id: taskId }, data: { workflowStatus: target, updatedAt: new Date() } })
    .then(() => true)
    .catch((err) => {
      log.warn({ err, taskId }, '[invariant-repair] task.update failed during repair — failing open');
      return false;
    });
  if (!updated) return { repaired: false, reason: 'db_update_failed' };
  log.info(
    { taskId, fromStatus: wf, toStatus: target, violation: violation.message },
    '[invariant-repair] missing_file violation repaired — workflowStatus rolled back',
  );
  return { repaired: true, newStatus: target };
}
