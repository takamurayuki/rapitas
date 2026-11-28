/**
 * verify-self-repair
 *
 * When the verify.md validator rejects a verifier's output (self-contradiction:
 * claims pass but body shows failures, or an explicit ❌ verdict), instead of
 * dead-ending the task at `blocked` this bounces the workflow BACK to the
 * implementer phase with the failure as feedback, so the runner re-runs
 * implement → verify automatically. Bounded by a per-task attempt cap (counted
 * from WorkflowTransition rows — no schema change); once exhausted the caller
 * blocks as before. Not responsible for spawning agents.
 *
 * Split into verify-self-repair-{budget,feedback,resume}.ts (task 764) and
 * verify-tamper-verdict.ts (task 1602) — this file keeps the orchestration
 * (attemptVerifyRepair) and re-exports what external callers import.
 */
import { prisma } from '../../config/database';
import { commitVerifyRepair, type RepairRoute } from './verify-repair-commit';
import { createLogger } from '../../config/logger';
import {
  VERIFY_NON_CONVERGENCE_CAUSE,
  VERIFY_REPAIR_LIFETIME_CAUSE,
  MAX_VERIFY_REPAIR_LIFETIME,
} from './blocked-task-policy';
import {
  resolveMaxRepairs,
  countPriorRepairs,
  countLifetimeRepairs,
  detectRepairNonConvergence,
  resolveRepairWindowStart,
} from './verify-self-repair-budget';
import { ensureRunnerResumes, resolveRepairCaller } from './verify-self-repair-resume';
import { buildUnchangedUnresolvedDetail } from './verify-unresolved-issues';
import { attemptInvariantCutoff } from './verify-invariant-repair';
import { NOT_REVIEW_COST_ROW } from '../agents/review-cost-rows';
import { isTamperOnlyVerdict, recordRepairCutoff } from './verify-tamper-verdict';

export {
  isTamperOnlyVerdict,
  resolveImplementEntryStatus,
  hasFreshVerifyRejection,
} from './verify-tamper-verdict';

const log = createLogger('workflow:verify-self-repair');

/** Transition cause recorded when a verdict is cut off as not repairable by the implementer. */
export const VERIFY_NON_REPAIRABLE_CAUSE = 'verify_repair_non_repairable';

export interface VerifyRepairResult {
  /** True when the workflow was bounced back to implement (caller must NOT block). */
  bounced: boolean;
  /** The workflowStatus to set so the implementer re-runs (when bounced). */
  newStatus?: string;
  /** 1-based attempt number for this bounce. */
  attempt?: number;
  /**
   * True when the bounce was skipped because the workflow already moved past
   * the evaluated status (stale verdict — e.g. a re-verify passed meanwhile).
   * Callers must treat this as "do nothing": neither bounce NOR block.
   */
  stale?: boolean;
  /** True when this call already recorded its own terminal transition (non-convergence cutoff) — callers must skip their own `verify_validation_failed` record to avoid double-recording (task 705). */
  cutoffRecorded?: boolean;
}

/** Grounds stored with the bounce, plus how the self-verify miss is filed. */
export interface VerifyRepairGrounds {
  findings?: unknown[];
  route?: RepairRoute;
  /** 'none': this rejection is not a self-verify miss (e.g. a GitHub merge conflict). */
  missGate?: 'none';
}

/**
 * File the rejection as a self-verify miss when a passing self-verify run
 * preceded it (task 1602). Never throws: the dynamic import keeps a test that
 * mocks the timeline module from losing this file to a missing export.
 */
async function fileSelfVerifyMiss(
  taskId: number,
  reason: string,
  grounds: VerifyRepairGrounds | undefined,
): Promise<void> {
  try {
    const { recordRepairMisses } = await import('./self-verify-miss');
    await recordRepairMisses(taskId, reason, grounds);
  } catch (err) {
    log.warn({ err, taskId }, '[verify-repair] Failed to file the self-verify miss');
  }
}

/**
 * Attempt a verify→implement self-repair bounce. Returns `bounced:false` (caller
 * should block) once the per-task attempt cap is reached, or when repairs are
 * disabled (RAPITAS_MAX_VERIFY_REPAIRS=0).
 *
 * @param taskId - Task being verified / 検証対象タスク
 * @param currentStatus - The workflowStatus at the time verify.md was saved / 現在のstatus
 * @param reason - Validator failure summary / 失敗要約
 * @param verifyContent - The rejected verify.md body / 却下されたverify.md
 * @param grounds - Diff-review findings and route, stored atomically with the bounce / 差し戻しと同時に保存する陪審の指摘と戻し先
 * @returns Whether the workflow was bounced and to which status / 戻したか・戻し先
 */
export async function attemptVerifyRepair(
  taskId: number,
  currentStatus: string | null,
  reason: string,
  verifyContent: string,
  grounds?: VerifyRepairGrounds,
): Promise<VerifyRepairResult> {
  // A completed task is never rolled back — completion means a newer verify
  // already passed (typically with a PR); this verdict is stale by definition.
  if (currentStatus === 'completed') {
    log.warn(
      { taskId },
      '[verify-repair] Verdict targets an already-completed task — skipping stale bounce',
    );
    return { bounced: false, stale: true };
  }

  // NOTE: task 1602 — filed before the repair-cap check (which used to come
  // first) so a miss counts even when repairs are disabled or exhausted.
  await fileSelfVerifyMiss(taskId, reason, grounds);

  const max = await resolveMaxRepairs();
  if (max === 0) return { bounced: false };

  const evaluatedTask = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true, workflowStatus: true, updatedAt: true },
  });
  if (
    !evaluatedTask ||
    evaluatedTask.status !== 'in-progress' ||
    evaluatedTask.workflowStatus === 'completed' ||
    (currentStatus === null && evaluatedTask.workflowStatus === 'verify_done') ||
    (currentStatus !== null && evaluatedTask.workflowStatus !== currentStatus)
  )
    return { bounced: false, stale: true };
  const evaluatedExecution = await prisma.agentExecution.findFirst({
    where: { ...NOT_REVIEW_COST_ROW, session: { config: { taskId } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  const caller = resolveRepairCaller();
  const prior = await countPriorRepairs(taskId);
  if (prior >= max) {
    log.warn(
      { taskId, caller, prior, max },
      '[verify-repair] Repair attempts exhausted — caller should block',
    );
    return { bounced: false };
  }

  // Non-repairable cutoff: only the tamper tripwire failed. No implementer
  // run can change that verdict — escalate on the first sighting instead of
  // spending the whole repair budget on identical bounces.
  if (isTamperOnlyVerdict(reason)) {
    await recordRepairCutoff({
      taskId,
      currentStatus,
      detail:
        '検証失敗が tamper ゲート（保護パスの計画外変更）のみで、実装者には解消できません。保護パス配下の変更は plan.md（またはタスク仕様）に明記して承認するか、人が差分を確認してコミットしてください。',
      cause: VERIFY_NON_REPAIRABLE_CAUSE,
      metadata: { reason },
    });
    log.warn({ taskId }, '[verify-repair] Tamper-only verdict — not repairable, cutting off');
    return { bounced: false, cutoffRecorded: true };
  }

  // Non-convergence cutoff (task 619): same criterion flagged threshold+ times
  // (not necessarily consecutive) with a non-shrinking indicted set means treading water — escalate.
  const verdict = await detectRepairNonConvergence(taskId, reason, verifyContent);
  if (verdict.cutoff) {
    const detail = verdict.unchangedUnresolved
      ? buildUnchangedUnresolvedDetail(verdict.unchangedUnresolved)
      : verdict.repeatedEvidence
        ? `同じ検証指摘「${verdict.repeatedEvidence.split('\n')[0]}」が${verdict.count}回の差し戻しで繰り返され、実装側で解消されていません。実装者では直せない指摘（存在しない前提・環境で実行不能な項目・計画の誤り）の可能性が高く、計画または仕様の見直しが必要です。`
        : `受入基準${verdict.criterionIndex}が${verdict.count}回の差し戻しで指摘され、指摘集合が減っていません。タスク分割または仕様の見直しが必要です。`;
    await recordRepairCutoff({
      taskId,
      currentStatus,
      detail,
      cause: VERIFY_NON_CONVERGENCE_CAUSE,
      metadata: {
        criterionIndex: verdict.criterionIndex,
        count: verdict.count,
        previousCriteria: verdict.previousCriteria,
        currentCriteria: verdict.currentCriteria,
        repeatedEvidence: verdict.repeatedEvidence,
        unchangedUnresolved: verdict.unchangedUnresolved,
        reason,
      },
    });
    log.warn(
      {
        taskId,
        criterionIndex: verdict.criterionIndex,
        count: verdict.count,
        previousCriteria: verdict.previousCriteria,
        currentCriteria: verdict.currentCriteria,
        repeatedEvidence: verdict.repeatedEvidence,
      },
      '[verify-repair] Repair loop not converging — cutting off (caller should block)',
    );
    return { bounced: false, cutoffRecorded: true };
  }

  // Lifetime cap (task 946): the windowed budget above resets on
  // question_resolved/task_retried/acceptance_criteria_changed/
  // plan_invalid_replan, so several resets can let repairs accumulate past
  // any single window's limit without ever tripping it (task 907: 18 bounces
  // across 3 windows of 7/3/8). This is a safety net independent of the
  // window boundary.
  const lifetimeCount = await countLifetimeRepairs(taskId);
  if (lifetimeCount >= MAX_VERIFY_REPAIR_LIFETIME) {
    await recordRepairCutoff({
      taskId,
      currentStatus,
      detail: `累計${lifetimeCount}回の修復差し戻しが上限（${MAX_VERIFY_REPAIR_LIFETIME}）を超えました。窓リセットにより個々の予算は消費されていませんが、タスク全体としては収束していません。`,
      cause: VERIFY_REPAIR_LIFETIME_CAUSE,
      metadata: { lifetimeCount, max: MAX_VERIFY_REPAIR_LIFETIME, reason },
    });
    log.warn(
      { taskId, lifetimeCount, max: MAX_VERIFY_REPAIR_LIFETIME },
      '[verify-repair] Lifetime repair cap exceeded — cutting off (caller should block)',
    );
    return { bounced: false, cutoffRecorded: true };
  }

  // Task 755: recurring checkWorkflowInvariants violations (task #572) — see verify-invariant-repair.ts.
  const invariantWindow = await resolveRepairWindowStart(taskId);
  if (await attemptInvariantCutoff(taskId, currentStatus, reason, invariantWindow))
    return { bounced: false, cutoffRecorded: true };

  const committed = await commitVerifyRepair(prisma, {
    taskId,
    updatedAt: evaluatedTask.updatedAt,
    workflowStatus: evaluatedTask.workflowStatus,
    executionId: evaluatedExecution?.id ?? null,
    max,
    reason,
    verifyContent,
    caller,
    // NOTE: routing2a-fix1 — the grounds must land in the same transaction as
    // the bounce; see RepairAdmission.findings.
    findings: grounds?.findings,
    route: grounds?.route,
  });
  if (!committed.committed) {
    log.info({ taskId, reason: committed.reason }, '[verify-repair] Repair admission held');
    return committed.reason === 'budget_exhausted' || committed.reason === 'repair_disabled'
      ? { bounced: false }
      : { bounced: false, stale: true };
  }
  const { attempt, newStatus } = committed;

  // Self-drive the re-run: a single/manual execution has no poller, so a
  // bounce would otherwise park the task at in-progress forever. Re-queue +
  // idempotently start the runner so implement→verify re-runs regardless of
  // launch mode.
  await ensureRunnerResumes(taskId, {
    updatedAt: committed.updatedAt,
    workflowStatus: newStatus,
    executionId: evaluatedExecution?.id ?? null,
  });

  log.info(
    { taskId, attempt, max, newStatus },
    '[verify-repair] Bounced verify failure back to implementer',
  );
  return { bounced: true, newStatus, attempt };
}
