/**
 * verify-fallback-jury-fail
 *
 * Applies a FAIL verdict of the CLI epilogue's fallback jury: bounce to the
 * implementer, or block when repairs are exhausted, then record the rejection.
 * Moved out of verify-fallback-jury-gate.ts unchanged (file-size split);
 * not responsible for running the jury or for commit/PR.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { recordTransition, type TransitionActor } from './transition-recorder';
import { writeBlockedTask } from './blocked-task-write';
import type { WorkflowAdvanceResult } from './workflow-types';
import type { FallbackJuryOutcome } from './verify-fallback-jury-gate';
import type { DiffReviewResult } from '../agents/verification/adversarial-diff-review-verdict';
import { capFindingsForStorage } from '../agents/verification/review-findings';

// NOTE: Same logger name as before the move so observed log `name`s stay the same.
const log = createLogger('workflow-cli-executor');

/**
 * Act on a FAIL verdict from the fallback jury.
 *
 * @param p.taskId - Task id / タスクID
 * @param p.currentWfStatus - Status the verdict was evaluated against / 評価時の状態
 * @param p.verifyContent - verify.md content / verify.md の内容
 * @param p.actor - Transition actor / 遷移の主体
 * @param p.sessionId - Agent session id / セッションID
 * @param p.review - The FAIL review / 不合格のレビュー
 * @param p.complete - Writes the gate completion record / 完了記録を書く関数
 * @returns The outcome for the caller and whether the verdict was acted on / 呼び出し側への結果
 */
export async function applyFallbackJuryFail(p: {
  taskId: number;
  currentWfStatus: string;
  verifyContent: string;
  actor: TransitionActor;
  sessionId: number;
  review: DiffReviewResult;
  complete: (outcome: 'stopped') => Promise<void>;
}): Promise<{ result: FallbackJuryOutcome; seen: 'stopped' | null }> {
  const { taskId, currentWfStatus, verifyContent, actor, sessionId, review } = p;
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
      seen: null,
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
  await p.complete('stopped');
  return { result: { stop: true, phaseStatus }, seen: 'stopped' };
}
