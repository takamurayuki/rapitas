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
import {
  withTaskJuryGate,
  JuryGateBusyError,
  readVerifySha256,
  findJuryGateCompletion,
  recordJuryGateCompletion,
} from './verify-jury-completion';
import { currentDiffFingerprint } from '../agents/verification/review-diff-fingerprint';
import { readCriteriaRevision } from '../task/task-criteria-revision';
import {
  withJuryRun,
  confirmJuryRunStillBound,
  type JuryRunHandle,
  type JuryRunSeen,
} from './jury-review-run';
import { capFindingsForStorage } from '../agents/verification/review-findings';

const log = createLogger('workflow-cli-executor');

/** Same title shape verify-completion-gate.ts uses to skip the jury for conflict fixes. */
const CONFLICT_RESOLUTION_TITLE_RE = /^PR #\d+ の競合を解消/;

/** Outcome of the fallback gate. `phaseStatus` is set only when the caller must stop. */
export interface FallbackJuryOutcome {
  /** True when the review failed and the caller must NOT commit/PR. */
  stop: boolean;
  phaseStatus?: WorkflowAdvanceResult['status'];
  /** Why the jury was not run, when it was skipped. */
  skipped?: 'already_reviewed' | 'conflict_resolution' | 'no_worktree' | 'gate_busy';
}

/**
 * Run the jury before the epilogue's commit/PR, honouring a FAIL like the
 * HTTP pipeline does. Never throws for review errors (they fail open exactly
 * as the jury itself does).
 *
 * Reuse rule: a previous gate's verdict is honoured only when its completion
 * record names this verify.md's sha256 AND the worktree's current diff
 * fingerprint (verify-jury-completion.ts). The gate runs under the per-task
 * jury lock, so an HTTP review still deciding is waited for, not raced.
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
  /** Wait limit for the other gate (tests shorten it). */
  gateMaxWaitMs?: number;
}): Promise<FallbackJuryOutcome> {
  try {
    return await withTaskJuryGate(params.taskId, () => runGateLocked(params), params.gateMaxWaitMs);
  } catch (err) {
    if (!(err instanceof JuryGateBusyError)) throw err;
    // The other gate is still deciding and owns the outcome: never commit
    // past it, and never act on the verdict in parallel with it.
    const live = await prisma.task
      .findUnique({ where: { id: params.taskId }, select: { workflowStatus: true } })
      .catch(() => null);
    const phaseStatus = (live?.workflowStatus ??
      params.currentWfStatus) as WorkflowAdvanceResult['status'];
    return { stop: true, phaseStatus, skipped: 'gate_busy' };
  }
}

async function runGateLocked(params: {
  taskId: number;
  currentWfStatus: string;
  verifyContent: string;
  worktreePath: string | null;
  actor: TransitionActor;
  sessionId: number;
}): Promise<FallbackJuryOutcome> {
  const { taskId, currentWfStatus } = params;
  const task = await prisma.task
    .findUnique({ where: { id: taskId }, select: { title: true, githubPrId: true } })
    .catch(() => null);
  if (task?.githubPrId != null && CONFLICT_RESOLUTION_TITLE_RE.test(task.title ?? '')) {
    return { stop: false, skipped: 'conflict_resolution' };
  }

  // NOTE: The verifier-eligibility hold moved to the caller
  // (workflow-cli-executor-verify-gate.ts), BEFORE its PR branch: here it ran
  // only when no PR existed, so an existing-PR re-verify skipped it
  // (G2 routing1 re-review item 3). By the time this gate runs it has passed.

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

  // The artifact version is read BEFORE the review: a verify.md saved while
  // the jury runs must not inherit this verdict. Reuse also needs the same
  // criteria revision (companion design 4.5): criteria changed alone = judge again.
  const verifySha256 = await readVerifySha256(taskId);
  const criteriaRevision = await readCriteriaRevision(prisma, taskId);
  const currentFingerprint = await currentDiffFingerprint(taskId, worktreePath);
  const done =
    verifySha256 && currentFingerprint && criteriaRevision
      ? await findJuryGateCompletion(taskId, {
          verifySha256,
          diffFingerprint: currentFingerprint,
          criteriaRevision,
        })
      : null;
  if (done?.outcome === 'passed') return { stop: false, skipped: 'already_reviewed' };
  if (done?.outcome === 'stopped') {
    // This exact artifact + diff was already rejected and the rejection was
    // acted on; it owns the next step. Report the live status, never commit.
    const live = await prisma.task
      .findUnique({ where: { id: taskId }, select: { workflowStatus: true } })
      .catch(() => null);
    const phaseStatus = (live?.workflowStatus ??
      currentWfStatus) as WorkflowAdvanceResult['status'];
    return { stop: true, phaseStatus, skipped: 'already_reviewed' };
  }

  // A real review runs under the DB lock (JuryReviewRun + Task.juryRunId,
  // design 4.5.1); the identifiers the run records are read after the lock.
  return withJuryRun(
    { taskId, source: 'cli_epilogue' },
    (run) => reviewAndApplyLocked({ ...params, worktreePath }, run),
    async () => ({
      stop: true,
      phaseStatus: await liveStatus(taskId, currentWfStatus),
      skipped: 'gate_busy',
    }),
  );
}

async function liveStatus(
  taskId: number,
  fallback: string,
): Promise<WorkflowAdvanceResult['status']> {
  const live = await prisma.task
    .findUnique({ where: { id: taskId }, select: { workflowStatus: true } })
    .catch(() => null);
  return (live?.workflowStatus ?? fallback) as WorkflowAdvanceResult['status'];
}

async function reviewAndApplyLocked(
  params: {
    taskId: number;
    currentWfStatus: string;
    verifyContent: string;
    worktreePath: string;
    actor: TransitionActor;
    sessionId: number;
  },
  run: JuryRunHandle,
): Promise<{ result: FallbackJuryOutcome; seen: JuryRunSeen }> {
  const { taskId, currentWfStatus, verifyContent, actor, sessionId, worktreePath } = params;
  const { reviewDiffAdversarially } =
    await import('../agents/verification/adversarial-diff-review');
  const review = await reviewDiffAdversarially({ taskId, worktreePath }).catch(() => null);
  const seen = (outcome: 'passed' | 'stopped' | null): JuryRunSeen => ({
    diffFingerprint: review?.diffFingerprint ?? null,
    verdict: review?.verdict ?? null,
    outcome,
  });
  // Design 4.5.1: the run must still own the lock and the criteria / verify.md
  // must be what it started on before ANY of the verdict is applied —
  // otherwise it is discarded (task halted) and nothing proceeds, not even commit.
  if (!(await confirmJuryRunStillBound(run, review))) {
    return {
      result: { stop: true, phaseStatus: await liveStatus(taskId, currentWfStatus) },
      seen: seen(null),
    };
  }
  const complete = (outcome: 'passed' | 'stopped') =>
    review?.diffFingerprint && run.verifySha256 && run.criteriaRevision
      ? recordJuryGateCompletion({
          taskId,
          verifySha256: run.verifySha256,
          diffFingerprint: review.diffFingerprint,
          criteriaRevision: run.criteriaRevision,
          juryRunId: run.id,
          verdict: review.verdict,
          outcome,
          source: 'cli_epilogue',
        })
      : Promise.resolve();
  if (review?.verdict === 'hold') {
    // Same review hold as the HTTP pipeline: no bounce, no commit/PR.
    const { holdFromReview } = await import('./review-hold');
    const held = await holdFromReview({
      taskId,
      review,
      source: 'cli_epilogue',
      fromStatus: currentWfStatus,
      actor,
      sessionId,
    });
    if (held === 'held') {
      await complete('stopped');
      return { result: { stop: true, phaseStatus: 'verify_done' }, seen: seen('stopped') };
    }
    // The task moved on meanwhile: neither hold nor commit, report its live status.
    return {
      result: { stop: true, phaseStatus: await liveStatus(taskId, currentWfStatus) },
      seen: seen(null),
    };
  }
  if (!review || review.verdict !== 'fail') {
    await complete('passed');
    return { result: { stop: false }, seen: seen('passed') };
  }

  const reason = `差分レビュー不合格: ${
    review.reasons.slice(0, 5).join(' / ') || '受入基準を満たしていません'
  }`;
  const { attemptVerifyRepair } = await import('./verify-self-repair');
  const { juryBounceGrounds } = await import('./repair-cause');
  // Grounds ride on the bounce row (see verify-adversarial-review.ts).
  const repair = await attemptVerifyRepair(
    taskId,
    currentWfStatus,
    reason,
    verifyContent,
    juryBounceGrounds(reason, capFindingsForStorage(review.findings)),
  );
  if (repair.stale) {
    // The workflow moved past the evaluated status meanwhile — neither
    // bounce nor block (same CAS rule as the hard-fail branch), and no
    // completion record: this verdict was not acted on.
    return {
      result: { stop: true, phaseStatus: currentWfStatus as WorkflowAdvanceResult['status'] },
      seen: seen(null),
    };
  }

  const { markLatestExecutionFailed } = await import('./publish/mark-latest-execution-failed');
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
        findings: capFindingsForStorage(review.findings),
        source: 'cli_epilogue',
      },
      invariantViolation: true,
      invariantMessage: reason,
    }).catch(() => {});
  }
  await complete('stopped');
  return { result: { stop: true, phaseStatus }, seen: seen('stopped') };
}
