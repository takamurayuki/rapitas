import { readReviewedPlanPolicy } from './reviewed-plan-policy';
/** Atomic admission and audit for a server-reviewed replan. Never dispatches agents. */
import type { PrismaClient } from '../../generated/prisma-postgres';
import { withTaskLifecycleLock } from './task-lifecycle-lock';
import {
  replanSnapshotDigest,
  validateReplanEvidence,
  type ReplanSnapshot,
} from './requirement-replan-evidence';
import {
  rejectReplanLifecycle,
  isRequirementReplanWindowExhausted,
  isExpectedReplanHold,
} from './requirement-replan-policy';
import type { ReplanReviewResult } from './requirement-replan-review';
import { THEME_STOP_INTENT } from '../agents/theme-stop-intent';
import { createLogger } from '../../config/logger';
import { RequirementReplanHeldError } from '../../middleware/error-handler';

const log = createLogger('workflow:requirement-replan-commit');

export const REQUIREMENT_REPLAN_CAUSE = 'requirement_evidence_replan';
/**
 * Cause for the audit row written when a requirement-replan budget is
 * exhausted (absolute `priorReplans >= 3`, or the task-956 60-minute window
 * guard) and the task is blocked as a result. Deliberately distinct from
 * {@link REQUIREMENT_REPLAN_CAUSE} so it is never itself counted toward
 * `priorReplans` on a later attempt.
 */
export const REQUIREMENT_REPLAN_EXHAUSTED_CAUSE = 'requirement_replan_budget_exhausted';
const STOP_CAUSES = new Set([
  THEME_STOP_INTENT,
  'manual_execution_stop_revert',
  'manual_execution_stop_withdraw',
  'auto_run_stop_revert',
]);

/** Invalid stored specification is an error, not an empty set of requirements. */
export function parseStoredRequirementArray(value: string | null): string[] {
  const parsed: unknown = JSON.parse(value ?? '[]');
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('Invalid stored requirement array');
  }
  return parsed;
}

/**
 * The review must be produced by the server, never deserialized from an API caller.
 * All reads, CAS, and the budget-bearing audit row share one serializable transaction.
 * A DB failure propagates and rolls back; callers must not continue to completion.
 */
export async function commitRequirementReplan(
  db: PrismaClient,
  taskId: number,
  evaluatedUpdatedAt: Date,
  review: ReplanReviewResult,
): Promise<{ committed: boolean; reason: string }> {
  return commitReviewedDecision(db, taskId, evaluatedUpdatedAt, review);
}

/** Server-held review receipt; never accept this structure from an HTTP caller. */
export interface CompletionReviewReceipt {
  taskId: number;
  executionId: number | null;
  evaluatedUpdatedAt: Date;
  review: ReplanReviewResult;
}

/** Advance only the reviewed verify version and return its exact new DB version. */
export async function advanceReviewedVerify(
  db: PrismaClient,
  receipt: CompletionReviewReceipt,
): Promise<CompletionReviewReceipt> {
  if (receipt.review.verdict.kind !== 'no_mismatch') throw new Error('Review is not passing');
  const result = await commitReviewedDecision(
    db,
    receipt.taskId,
    receipt.evaluatedUpdatedAt,
    receipt.review,
    {
      cause: 'verify_review_admitted',
      executionId: receipt.executionId,
    },
  );
  if (!result.committed || !result.updatedAt)
    throw new Error(`Reviewed verify transition held: ${result.reason}`);
  return { ...structuredClone(receipt), evaluatedUpdatedAt: result.updatedAt };
}

/** Call only after the existing quality, commit, PR and merge gates succeeded. */
export async function completeReviewedTask(
  db: PrismaClient,
  receipt: CompletionReviewReceipt,
  completion: {
    cause: 'verify_passed' | 'verify_no_change_confirmed' | 'conflict_resolution_completed';
    sessionId?: number;
  },
): Promise<{ committed: boolean; reason: string }> {
  if (receipt.review.verdict.kind !== 'no_mismatch')
    return { committed: false, reason: 'review_not_passing' };
  return commitReviewedDecision(db, receipt.taskId, receipt.evaluatedUpdatedAt, receipt.review, {
    ...completion,
    executionId: receipt.executionId,
  });
}

/** Read-only admission immediately before external work; final completion must recheck. */
export async function assertReviewedTaskCurrent(
  db: PrismaClient,
  receipt: CompletionReviewReceipt,
): Promise<void> {
  if (receipt.review.verdict.kind !== 'no_mismatch') throw new Error('Review is not passing');
  const result = await commitReviewedDecision(
    db,
    receipt.taskId,
    receipt.evaluatedUpdatedAt,
    receipt.review,
    {
      cause: 'verify_side_effect_check',
      executionId: receipt.executionId,
    },
  );
  if (result.reason !== 'review_current') {
    // NOTE (task #1041): stale_task / execution_superseded / review_in_progress
    // etc. are the same expected state guards status-transition.ts already
    // classifies via isExpectedReplanHold (#961, #1023) — a concurrent update
    // between review-admission and this side-effect check, not a crash.
    // Throwing RequirementReplanHeldError (AppError) here too keeps this
    // second call site from double-logging the same held state as ERROR
    // (see middleware/error-handler.ts and workflow-handlers-files.ts).
    if (isExpectedReplanHold(result.reason)) {
      throw new RequirementReplanHeldError(result.reason);
    }
    throw new Error(`Reviewed external work held: ${result.reason}`);
  }
}

async function commitReviewedDecision(
  db: PrismaClient,
  taskId: number,
  evaluatedUpdatedAt: Date,
  review: ReplanReviewResult,
  completion?: {
    cause:
      | 'verify_passed'
      | 'verify_no_change_confirmed'
      | 'conflict_resolution_completed'
      | 'verify_review_admitted'
      | 'verify_side_effect_check';
    sessionId?: number;
    executionId: number | null;
  },
): Promise<{ committed: boolean; reason: string; updatedAt?: Date }> {
  const verdict = review.verdict;
  // Preserve the server review's diagnostic reason. Returning the generic
  // verdict kind made every fail-closed outcome look identical to callers,
  // so an unchanged task could be retried without exposing whether the input
  // was too large, the reviewer was unavailable, or evidence was missing.
  if (verdict.kind === 'unknown') return { committed: false, reason: verdict.reason };
  if (verdict.kind === 'mismatch' && review.snapshotDigest !== verdict.evidence.snapshotDigest) {
    return { committed: false, reason: 'review_digest_mismatch' };
  }
  const outcome = await withTaskLifecycleLock(taskId, () =>
    db.$transaction(
      async (tx) => {
        const task = await tx.task.findUnique({
          where: { id: taskId },
          select: {
            id: true,
            title: true,
            description: true,
            goals: true,
            constraints: true,
            acceptanceCriteria: true,
            status: true,
            workflowStatus: true,
            workflowMode: true,
            updatedAt: true,
            themeId: true,
          },
        });
        if (!task) return { committed: false, reason: 'task_missing' };
        if (
          completion &&
          completion.cause !== 'verify_review_admitted' &&
          task.status === 'done' &&
          task.workflowStatus === 'completed'
        )
          return { committed: false, reason: 'already_completed' };
        const [plan, verify, execution, history, priorReplanRows, theme] = await Promise.all([
          tx.workflowFile.findUnique({
            where: { taskId_fileType: { taskId, fileType: 'plan' } },
            select: { content: true },
          }),
          tx.workflowFile.findUnique({
            where: { taskId_fileType: { taskId, fileType: 'verify' } },
            select: { content: true },
          }),
          tx.agentExecution.findFirst({
            where: { session: { config: { taskId } } },
            orderBy: { id: 'desc' },
            select: { id: true, status: true, startedAt: true },
          }),
          tx.workflowTransition.findFirst({
            // A later unrelated user edit is not a resume and must not hide the stop.
            where: { taskId, cause: { in: [...STOP_CAUSES] } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { cause: true, createdAt: true },
          }),
          tx.workflowTransition.findMany({
            where: { taskId, cause: REQUIREMENT_REPLAN_CAUSE },
            select: { createdAt: true },
          }),
          task.themeId === null
            ? null
            : tx.themeAutoRun.findUnique({
                where: { themeId: task.themeId },
                select: { status: true },
              }),
        ]);
        const priorReplans = priorReplanRows.length;
        // task 956: a same-cause repeat-loop can fire before the absolute
        // budget above is exhausted — see isRequirementReplanWindowExhausted.
        const windowExhausted = isRequirementReplanWindowExhausted(
          priorReplanRows.map((r) => ({ createdAtMs: r.createdAt.getTime() })),
          Date.now(),
        );
        const unresumedStop =
          history &&
          STOP_CAUSES.has(history.cause) &&
          (!execution?.startedAt || execution.startedAt <= history.createdAt)
            ? history.cause
            : null;
        const rejected = rejectReplanLifecycle(
          {
            status: task.status,
            workflowStatus: task.workflowStatus,
            updatedAt: task.updatedAt,
            latestExecutionStatus: execution?.status ?? null,
            latestStopCause: unresumedStop,
            themeStatus: theme?.status ?? null,
            priorReplans,
          },
          evaluatedUpdatedAt,
        );
        // task 956: fold the window-local early-stop into the same
        // 'budget_exhausted' outcome as the absolute priorReplans>=3 cap —
        // one unified exit, not a second parallel budget with its own shape.
        const effectiveRejected = rejected ?? (windowExhausted ? 'budget_exhausted' : null);
        // A successful review does not consume another replan attempt, but still
        // requires all stop and lifecycle guards, even when Task.updatedAt is unchanged.
        if (
          effectiveRejected &&
          !(verdict.kind === 'no_mismatch' && effectiveRejected === 'budget_exhausted')
        ) {
          let blockedNow = false;
          if (effectiveRejected === 'budget_exhausted' && task.status !== 'blocked') {
            // Prior to task 956 this reason was returned with no state change —
            // the caller (verify-gate) just threw, and the same verify→replan
            // cycle could be re-entered on the next attempt. Blocking here once
            // gives budget_exhausted a single, durable exit regardless of which
            // of the two budgets (absolute or windowed) tripped it.
            const blockedUpdatedAt = new Date(Math.max(Date.now(), task.updatedAt.getTime() + 1));
            const blockedChange = await tx.task.updateMany({
              where: {
                id: taskId,
                status: task.status,
                workflowStatus: task.workflowStatus,
                updatedAt: task.updatedAt,
              },
              data: { status: 'blocked', updatedAt: blockedUpdatedAt },
            });
            if (blockedChange.count === 1) {
              blockedNow = true;
              await tx.workflowTransition.create({
                data: {
                  taskId,
                  fromStatus: task.workflowStatus,
                  toStatus: task.workflowStatus ?? 'blocked',
                  actor: 'system',
                  cause: REQUIREMENT_REPLAN_EXHAUSTED_CAUSE,
                  phase: 'plan',
                  metadata: JSON.stringify({
                    priorReplans,
                    windowExhausted,
                    reason: verdict.kind === 'mismatch' ? verdict.reason : null,
                  }),
                },
              });
            }
          }
          return { committed: false, reason: effectiveRejected, blockedNow };
        }
        if (completion && (execution?.id ?? null) !== completion.executionId)
          return { committed: false, reason: 'execution_superseded' };
        const planPolicy = await readReviewedPlanPolicy(tx, task.workflowMode ?? 'comprehensive');
        if (!verify || (planPolicy.includePlan && !plan))
          return { committed: false, reason: 'artifact_missing' };
        const snapshot: ReplanSnapshot = {
          title: task.title,
          description: task.description ?? '',
          goals: parseStoredRequirementArray(task.goals),
          constraints: parseStoredRequirementArray(task.constraints),
          acceptanceCriteria: parseStoredRequirementArray(task.acceptanceCriteria),
          planPolicy,
          plan: plan?.content ?? '',
          verify: verify.content,
        };
        if (verdict.kind === 'no_mismatch') {
          if (replanSnapshotDigest(snapshot) !== review.snapshotDigest)
            return { committed: false, reason: 'stale_snapshot' };
          if (!completion) return { committed: false, reason: 'no_mismatch' };
          if (await tx.task.count({ where: { parentId: taskId, status: { not: 'done' } } }))
            return { committed: false, reason: 'open_subtasks' };
          if (completion.cause === 'verify_side_effect_check')
            return { committed: false, reason: 'review_current' };
          const verifyOnly = completion.cause === 'verify_review_admitted';
          const updatedAt = new Date();
          const toStatus = verifyOnly ? 'verify_done' : 'completed';
          const changed = await tx.task.updateMany({
            where: {
              id: taskId,
              status: task.status,
              workflowStatus: task.workflowStatus,
              updatedAt: task.updatedAt,
            },
            data: verifyOnly
              ? { workflowStatus: toStatus, updatedAt }
              : { status: 'done', workflowStatus: toStatus, completedAt: updatedAt, updatedAt },
          });
          if (changed.count !== 1) return { committed: false, reason: 'stale_task' };
          await tx.workflowTransition.create({
            data: {
              taskId,
              fromStatus: task.workflowStatus,
              toStatus,
              actor: 'system',
              cause: completion.cause,
              phase: 'verify',
              sessionId: completion.sessionId,
              metadata: JSON.stringify({
                snapshotDigest: review.snapshotDigest,
                reason: verdict.reason,
              }),
            },
          });
          return verifyOnly
            ? { committed: true, reason: completion.cause, updatedAt }
            : { committed: true, reason: completion.cause };
        }
        const invalid = validateReplanEvidence(snapshot, verdict.evidence);
        if (invalid) return { committed: false, reason: invalid };
        // Persist the exact post-transition generation in the same transaction.
        // Recovery must not guess a fresh authorization from the current task.
        const updatedAt = new Date(Math.max(Date.now(), task.updatedAt.getTime() + 1));
        const updated = await tx.task.updateMany({
          where: {
            id: taskId,
            status: task.status,
            workflowStatus: task.workflowStatus,
            updatedAt: task.updatedAt,
          },
          data: { workflowStatus: 'research_done', updatedAt },
        });
        if (updated.count !== 1) return { committed: false, reason: 'stale_task' };
        // This audit write intentionally does NOT use the best-effort recordTransition helper.
        await tx.workflowTransition.create({
          data: {
            taskId,
            fromStatus: task.workflowStatus,
            toStatus: 'research_done',
            actor: 'system',
            cause: REQUIREMENT_REPLAN_CAUSE,
            phase: 'plan',
            metadata: JSON.stringify({
              attempt: priorReplans + 1,
              max: 3,
              evidence: verdict.evidence,
              snapshot,
              reason: verdict.reason,
              durationMs: review.durationMs,
              tokensUsed: review.tokensUsed,
              modelName: review.modelName,
              resumeReceipt: {
                updatedAt,
                workflowStatus: 'research_done',
                executionId: execution?.id ?? null,
              },
            }),
          },
        });
        return { committed: true, reason: REQUIREMENT_REPLAN_CAUSE };
      },
      { isolationLevel: 'Serializable' },
    ),
  );
  if (outcome.blockedNow) {
    // Best-effort notification: the state change (blocked + audit row) is
    // already durable at this point regardless of whether this write lands.
    try {
      await db.notification.create({
        data: {
          type: 'blocked_escalation',
          title: 'ブロックされたタスクが対応待ちです',
          message: `#${taskId} は要件差し戻し（requirement replan）が収束せず自動再試行の対象外になりました。差し戻しが繰り返されている受入基準・plan/verify の内容を確認してください。`,
          link: `/tasks?taskId=${taskId}`,
          metadata: JSON.stringify({ taskId, source: 'requirement_replan_budget_exhausted' }),
        },
      });
    } catch (err) {
      log.warn({ err, taskId }, '[requirement-replan] budget-exhausted notification failed');
    }
  }
  const { blockedNow: _blockedNow, ...rest } = outcome;
  return rest;
}
