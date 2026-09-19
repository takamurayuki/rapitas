/**
 * Verify Requirement-Plan Mismatch
 *
 * Detects the ONE structurally-certain requirement/plan mismatch this
 * codebase can prove without ambiguity: an acceptance criterion that still
 * references the supervisor/verifier's own investigation scratch path
 * (`.supervisor/...`) at verify time. Backend code never references that
 * path, so its presence in a criterion is not a normal unmet requirement —
 * it is investigation narrative that survived into implementation
 * obligations. When found, rolls the workflow back to re-plan (bounded,
 * audited, SYSTEM-attributed — never impersonating a human `revise-plan`
 * request), instead of letting verify complete around it or a bare concern
 * filing absorb it.
 *
 * Deliberately narrow: ordinary unmet acceptance criteria (no `.supervisor/`
 * reference) are NOT this module's concern — they remain governed by the
 * existing `verify_no_convergence` escalation
 * (services/workflow/verify-self-repair.ts), which this module does not
 * replace, duplicate, or interact with (separate `cause`, separate count).
 *
 * Deliberately independent of workflow-orchestrator-plan-guard.ts: same
 * shared helpers (countWithFailClosed / writeBlockedStatusDurable /
 * scheduleWorkflowRedispatch / archiveWorkflowFile), but the rollback
 * source (verify, not implementer-entry), the target status, and the
 * stop-state guard are all specific to this path — copying that guard's
 * body would not have carried its safety properties.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { archiveWorkflowFile } from './workflow-file-utils';
import { recordTransition } from './transition-recorder';
import { countWithFailClosed } from '../../utils/database/fail-closed-count';
import { writeBlockedStatusDurable } from './durable-blocked-write';
import { scheduleWorkflowRedispatch } from './workflow-redispatch';
import { findSupervisorArtifactCriteria } from '../intake/spec-coherence-checker';
import { reviewRequirementPlanMismatch } from './requirement-plan-mismatch-reviewer';

const log = createLogger('workflow:requirement-plan-mismatch');

/** Transition cause recorded for this module's own rollback (SYSTEM-attributed, never `plan_revision_requested`). */
export const REQUIREMENT_MISMATCH_CAUSE = 'requirement_plan_mismatch_replan';

/** Max bounded re-plan attempts before blocking instead of looping (60-minute window). */
export const MAX_REQUIREMENT_REPLANS = 3;

/** Cost cap: at most this many non-`.supervisor/` criteria get an AI review per verify save. */
const MAX_GENERAL_REVIEW_CRITERIA = 3;

/** Stop-transition causes that must never be auto-resumed by this path (mirrors status-transition.ts's question-save guard). */
const STOP_CAUSES = new Set([
  'manual_execution_stop_revert',
  'manual_execution_stop_withdraw',
  'auto_run_stop_revert',
]);

/** Terminal task statuses that must never be rolled back by this path (task 901's completed→awaiting_question overwrite, reproduced here for the same class of bug). */
const TERMINAL_STATUSES = new Set(['done', 'completed', 'cancelled']);

/**
 * Whether any acceptance criterion still references the supervisor's own
 * investigation scratch path.
 *
 * @param acceptanceCriteria - Resolved acceptance criteria. / 受入基準
 * @returns Hit flag plus the first offending criterion, if any. / 判定結果
 */
export function detectSupervisorArtifactMismatch(acceptanceCriteria: string[]): {
  hit: boolean;
  criterion?: string;
} {
  const hits = findSupervisorArtifactCriteria(acceptanceCriteria);
  if (hits.length === 0) return { hit: false };
  return { hit: true, criterion: hits[0].criterion };
}

/**
 * Path-name-independent fallback: reviews (via AI, grounded in the task's own
 * description) whichever acceptance criteria do NOT already carry the
 * `.supervisor/` signal, so a legitimate future requirement the plan excludes
 * — or a past investigation narrative that must not be enforced — can be
 * told apart without relying on a specific scratch-path string. Only called
 * when {@link detectSupervisorArtifactMismatch} found nothing (cost/latency
 * gate: the structural check is free and decisive when it hits).
 *
 * @param params - Full acceptance criteria, the task description, and the current plan. / 入力一式
 * @returns Hit flag plus the first mismatched criterion, if any. / 判定結果
 */
export async function detectGeneralRequirementMismatch(params: {
  acceptanceCriteria: string[];
  description: string;
  currentPlan: string;
}): Promise<{ hit: boolean; criterion?: string }> {
  const { acceptanceCriteria, description, currentPlan } = params;
  const candidates = acceptanceCriteria.slice(0, MAX_GENERAL_REVIEW_CRITERIA);
  for (const criterion of candidates) {
    const review = await reviewRequirementPlanMismatch({ description, criterion, currentPlan });
    if (review.verdict === 'mismatch') {
      return { hit: true, criterion };
    }
    // 'no_mismatch' and 'unknown' both mean "do not replan" — an unproven
    // signal must never trigger a rollback (fail-closed toward inaction).
  }
  return { hit: false };
}

/**
 * Whether a snapshot status is one this path must never roll back: a
 * deliberate stop (task.status `todo` + a recorded stop-cause transition) or
 * a terminal outcome (`done`/`completed`/`cancelled`). On any DB read
 * failure this fails CLOSED (treated as blocked) so a transient error can
 * never cause this path to replan a task that was actually stopped or done.
 */
async function isStatusBlocked(taskId: number, status: string): Promise<boolean> {
  if (TERMINAL_STATUSES.has(status)) return true;
  if (status !== 'todo') return false;

  const lastUserTransition = await prisma.workflowTransition
    .findFirst({
      where: { taskId, OR: [{ actor: 'user' }, { cause: 'auto_run_stop_revert' }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { cause: true },
    })
    .catch((err: unknown) => {
      log.warn(
        { err, taskId },
        '[requirement-plan-mismatch] stop-history lookup failed — treating as stopped',
      );
      return undefined;
    });
  if (lastUserTransition === undefined) return true;
  return lastUserTransition !== null && STOP_CAUSES.has(lastUserTransition.cause);
}

/**
 * Whether the task is currently STOPPED or already in a terminal state —
 * mirrors status-transition.ts's question-save stop guard, extended to also
 * treat `done`/`completed`/`cancelled` as never-rollback (task 901's
 * completed→awaiting_question overwrite). On any DB read failure this fails
 * CLOSED (treated as stopped) so a transient error can never cause this path
 * to replan a task that was actually stopped or done.
 */
async function isTaskStopped(taskId: number): Promise<boolean> {
  const task = await prisma.task
    .findUnique({ where: { id: taskId }, select: { status: true } })
    .catch((err: unknown) => {
      log.warn(
        { err, taskId },
        '[requirement-plan-mismatch] status lookup failed — treating as stopped',
      );
      return undefined;
    });
  // Missing row or a failed lookup are both treated as "do not proceed" —
  // this path is only ever entered right after a real task saved verify.md,
  // so an absent/unreadable task row is anomalous, not a normal case to
  // fail open on.
  if (!task) return true;
  return isStatusBlocked(taskId, task.status);
}

/**
 * Attempt a bounded, audited, SYSTEM-attributed rollback to re-plan when a
 * verify.md save still carries an acceptance criterion referencing the
 * supervisor's investigation scratch path. Never impersonates a human
 * `revise-plan` request (separate `cause` from `PLAN_REVISION_CAUSE`).
 *
 * @param params - Task id, pre-save status, the offending criterion, and output language. / 入力一式
 * @returns Whether the rollback landed, or whether the loop was blocked instead. / 結果
 */
export async function attemptRequirementPlanReplan(params: {
  taskId: number;
  currentStatus: string | null;
  criterion: string;
  language: 'ja' | 'en';
}): Promise<{ replanned: boolean; blocked?: boolean }> {
  const { taskId, currentStatus, criterion, language } = params;

  if (await isTaskStopped(taskId)) {
    log.info({ taskId }, '[requirement-plan-mismatch] task is stopped — skipping auto-replan');
    return { replanned: false };
  }

  const priorReplans = await countWithFailClosed(
    prisma.workflowTransition.count({
      where: {
        taskId,
        cause: REQUIREMENT_MISMATCH_CAUSE,
        createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
      },
    }),
    MAX_REQUIREMENT_REPLANS,
    log,
    { taskId },
    'requirement-plan-mismatch-replan',
  );

  if (priorReplans >= MAX_REQUIREMENT_REPLANS) {
    log.warn(
      { taskId, priorReplans },
      '[requirement-plan-mismatch] still mismatched after repeated re-plans — blocking instead of looping',
    );
    await writeBlockedStatusDurable({
      taskId,
      log,
      source: 'RequirementPlanMismatch',
      notification: {
        title: '受入基準と計画の不整合により再計画を打ち切りました',
        message: `タスク #${taskId} は受入基準が監督専用の調査記録パスを参照する不整合が繰り返し検出されたため、自動再計画を打ち切りブロックしました。手動で確認してください。`,
      },
    });
    await recordTransition({
      taskId,
      fromStatus: currentStatus,
      toStatus: currentStatus ?? 'in_progress',
      actor: 'system',
      cause: `${REQUIREMENT_MISMATCH_CAUSE}_exhausted`,
      phase: 'verify',
      metadata: { priorReplans, criterion },
      invariantViolation: true,
      invariantMessage:
        'acceptance criteria kept referencing the supervisor investigation scratch path after repeated re-plans; blocked to stop the loop',
    }).catch(() => {});
    return { replanned: false, blocked: true };
  }

  // Re-read and re-judge immediately before the destructive write: DB I/O
  // (countWithFailClosed above) elapsed between the initial isTaskStopped()
  // check and here, and a stop/terminal transition could have landed in that
  // window (failureQuote: "isTaskStopped判定後、archiveWorkflowFile/task.update
  // 実行までの間に競合の余地がある").
  const snapshot = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: { status: true, workflowStatus: true, updatedAt: true },
    })
    .catch((err: unknown) => {
      log.warn(
        { err, taskId },
        '[requirement-plan-mismatch] pre-rollback status re-read failed — skipping this attempt',
      );
      return undefined;
    });
  if (!snapshot) return { replanned: false };
  if (await isStatusBlocked(taskId, snapshot.status)) {
    log.info(
      { taskId },
      '[requirement-plan-mismatch] task became stopped/terminal just before rollback — skipping',
    );
    return { replanned: false };
  }

  const archived = await archiveWorkflowFile(taskId, 'plan').catch(() => false);
  // CAS on the snapshot just read: if another process changed the row in the
  // meantime, `count` comes back 0 and this attempt does nothing rather than
  // clobbering whatever that other write did (task 901's overwrite bug).
  const casResult = await prisma.task
    .updateMany({
      where: {
        id: taskId,
        status: snapshot.status,
        workflowStatus: snapshot.workflowStatus,
        updatedAt: snapshot.updatedAt,
      },
      data: { workflowStatus: 'draft', updatedAt: new Date() },
    })
    .catch((err: unknown) => {
      log.warn(
        { err, taskId },
        '[requirement-plan-mismatch] workflowStatus rollback write failed — skipping this attempt (re-evaluated on next verify save)',
      );
      return undefined;
    });
  if (!casResult || casResult.count !== 1) {
    if (casResult) {
      log.info(
        { taskId },
        '[requirement-plan-mismatch] concurrent update detected (CAS miss) — skipping this attempt',
      );
    }
    return { replanned: false };
  }

  await recordTransition({
    taskId,
    fromStatus: currentStatus,
    toStatus: 'draft',
    actor: 'system',
    cause: REQUIREMENT_MISMATCH_CAUSE,
    phase: 'verify',
    metadata: { criterion, reason: 'supervisor_artifact_reference', planArchived: archived },
  }).catch(() => {});
  scheduleWorkflowRedispatch(taskId, 'requirement_plan_mismatch', language);
  return { replanned: true };
}
