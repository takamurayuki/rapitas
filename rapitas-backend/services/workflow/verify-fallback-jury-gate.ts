/**
 * verify-fallback-jury-gate
 *
 * Runs the adversarial diff-review jury on the CLI/orchestrator verify
 * epilogue (resolveVerifyPhaseStatus) before it commits/opens a PR, when the
 * HTTP verify.md save pipeline did not already judge this artifact. Mirrors
 * that pipeline's FAIL handling (bounce to implementer, block when repairs
 * are exhausted). Not responsible for commit/PR or completion.
 *
 * Why: in production most verify.md artifacts are HARVESTED by the epilogue
 * (writeWorkflowFile) rather than PUT over HTTP, so the jury — which lived
 * only in the HTTP post-save pipeline — never ran before
 * performAutoCommitAndPR on that path.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { recordTransition, type TransitionActor } from './transition-recorder';
import { writeBlockedTask } from './blocked-task-write';
import type { WorkflowAdvanceResult } from './workflow-types';

const log = createLogger('workflow-cli-executor');

/** Same title shape verify-completion-gate.ts uses to skip the jury for conflict fixes. */
const CONFLICT_RESOLUTION_TITLE_RE = /^PR #\d+ の競合を解消/;

/** Outcome of the fallback gate. `phaseStatus` is set only when the caller must stop. */
export interface FallbackJuryOutcome {
  /** True when the review failed and the caller must NOT commit/PR. */
  stop: boolean;
  phaseStatus?: WorkflowAdvanceResult['status'];
  /** Why the jury was not run, when it was skipped. */
  skipped?: 'already_reviewed' | 'conflict_resolution' | 'no_worktree';
}

/**
 * Whether the HTTP save pipeline already ran a production jury on the
 * current verify.md (an `adversarial_review` event newer than the artifact).
 *
 * @param taskId - Task id / タスクID
 * @returns True when this verify.md was already judged / 既に審査済みなら true
 */
export async function juryAlreadyRanForCurrentVerify(taskId: number): Promise<boolean> {
  const artifact = await prisma.workflowFile
    .findFirst({ where: { taskId, fileType: 'verify' }, select: { updatedAt: true } })
    .catch(() => null);
  if (!artifact) return false;
  const { queryEvents } = await import('../memory/timeline');
  const { events } = await queryEvents({
    eventType: 'adversarial_review',
    correlationId: `task-${taskId}`,
    since: artifact.updatedAt,
    limit: 1,
  }).catch(() => ({ events: [] as unknown[] }));
  return events.length > 0;
}

/**
 * Run the jury before the epilogue's commit/PR, honouring a FAIL like the
 * HTTP pipeline does. Never throws for review errors (they fail open exactly
 * as the jury itself does).
 *
 * @param params - Task, evaluated status, verify.md, worktree, actor/session for transitions / 入力一式
 * @returns Whether the caller must stop, and with which phase status / 呼び出し側が止まるべきか
 */
export async function runFallbackJuryGate(params: {
  taskId: number;
  currentWfStatus: string;
  verifyContent: string;
  worktreePath: string | null;
  actor: TransitionActor;
  sessionId: number;
}): Promise<FallbackJuryOutcome> {
  const { taskId, currentWfStatus, verifyContent, actor, sessionId } = params;
  const task = await prisma.task
    .findUnique({ where: { id: taskId }, select: { title: true, githubPrId: true } })
    .catch(() => null);
  if (task?.githubPrId != null && CONFLICT_RESOLUTION_TITLE_RE.test(task.title ?? '')) {
    return { stop: false, skipped: 'conflict_resolution' };
  }
  if (await juryAlreadyRanForCurrentVerify(taskId)) {
    return { stop: false, skipped: 'already_reviewed' };
  }

  let worktreePath = params.worktreePath;
  if (!worktreePath) {
    const s = await prisma.agentSession
      .findFirst({
        where: { config: { taskId }, worktreePath: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { worktreePath: true },
      })
      .catch(() => null);
    worktreePath = s?.worktreePath ?? null;
  }
  if (!worktreePath) return { stop: false, skipped: 'no_worktree' };

  const { reviewDiffAdversarially } =
    await import('../agents/verification/adversarial-diff-review');
  const review = await reviewDiffAdversarially({ taskId, worktreePath }).catch(() => null);
  if (!review || review.verdict !== 'fail') return { stop: false };

  const reason = `差分レビュー不合格: ${
    review.reasons.slice(0, 5).join(' / ') || '受入基準を満たしていません'
  }`;
  const { attemptVerifyRepair } = await import('./verify-self-repair');
  const repair = await attemptVerifyRepair(taskId, currentWfStatus, reason, verifyContent);
  if (repair.stale) {
    // The workflow moved past the evaluated status meanwhile — neither
    // bounce nor block (same CAS rule as the hard-fail branch).
    return { stop: true, phaseStatus: currentWfStatus as WorkflowAdvanceResult['status'] };
  }

  const { markLatestExecutionFailed } =
    await import('../../routes/workflow/handlers/file-save/shared');
  await markLatestExecutionFailed(taskId, reason);
  let phaseStatus = currentWfStatus as WorkflowAdvanceResult['status'];
  if (repair.bounced && repair.newStatus) {
    phaseStatus = repair.newStatus as WorkflowAdvanceResult['status'];
    log.warn(
      { taskId, attempt: repair.attempt, severity: review.severity },
      '[WorkflowCLIExecutor] Adversarial review FAILED on the epilogue path — bounced to implementer',
    );
  } else {
    await writeBlockedTask(prisma, taskId).catch(() => {});
    log.warn(
      { taskId, severity: review.severity },
      '[WorkflowCLIExecutor] Adversarial review FAILED on the epilogue path and repairs exhausted — blocked',
    );
  }
  if (!repair.cutoffRecorded) {
    await recordTransition({
      taskId,
      fromStatus: currentWfStatus,
      toStatus: phaseStatus,
      actor,
      cause: 'adversarial_review_failed',
      phase: 'verify',
      sessionId,
      metadata: {
        severity: review.severity,
        reasons: review.reasons.slice(0, 5),
        findings: review.findings?.slice(0, 12),
        source: 'cli_epilogue',
      },
      invariantViolation: true,
      invariantMessage: reason,
    }).catch(() => {});
  }
  return { stop: true, phaseStatus };
}
