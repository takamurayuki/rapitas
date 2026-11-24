/**
 * FileSave Verify Adversarial Recovery Block
 *
 * Blocks a task whose adversarial-review FAIL comes from branch-history
 * contamination that the worktree rebuild can no longer fix (recovery already
 * used, or the patch failed to apply after the old worktree was destroyed).
 * Moved out of verify-adversarial-review.ts unchanged except that the status
 * it compares against is a parameter (task 1538: a pending review runs while
 * the task is still in_progress). Not responsible for the review itself or
 * for the implementer bounce.
 */
import { prisma } from '../../../../config';
import { createLogger } from '../../../../config/logger';
import { recordTransition } from '../../../../services/workflow/transition-recorder';
import { capFindingsForStorage } from '../../../../services/agents/verification/review-findings';
import type { DiffReviewResult } from '../../../../services/agents/verification/adversarial-diff-review-verdict';
import { markLatestExecutionFailed } from './shared';

const log = createLogger('routes:workflow:handlers:files');

/** Outcome of the block attempt. */
export interface RecoveryBlockOutcome {
  /** The task left `fromStatus` while the review ran; nothing was written. */
  stale: boolean;
  /** Status the task is actually at, when stale. */
  liveStatus?: string;
}

/**
 * Block the task (no implementer bounce) because contamination recovery is
 * exhausted or failed — only while it is still at `fromStatus`.
 *
 * @param p.taskId - Task id / タスクID
 * @param p.fromStatus - Status the review was evaluated against / 評価時の状態
 * @param p.recoveryReason - Why recovery could not help / リカバリ不可の理由
 * @param p.review - The deciding FAIL review / 不合格のレビュー
 * @param p.reason - Human-readable failure reason / 失敗理由
 * @returns Whether the verdict arrived stale / 古い判定だったか
 */
export async function blockUnrecoverableContamination(p: {
  taskId: number;
  fromStatus: string;
  recoveryReason: 'recovery_already_used' | 'patch_apply_conflict';
  review: DiffReviewResult;
  reason: string;
}): Promise<RecoveryBlockOutcome> {
  const { taskId, fromStatus, recoveryReason, review, reason } = p;
  const liveTask = await prisma.task
    .findUnique({ where: { id: taskId }, select: { workflowStatus: true } })
    .catch(() => null);
  if (liveTask?.workflowStatus !== fromStatus) {
    log.warn(
      {
        taskId,
        recoveryReason,
        actualStatus: liveTask?.workflowStatus,
        reasons: review.reasons.slice(0, 5),
      },
      '[Workflow] Recovery-blocked verdict arrived after the workflow moved on — skipping',
    );
    return { stale: true, liveStatus: liveTask?.workflowStatus ?? undefined };
  }
  const blockedTitle =
    recoveryReason === 'recovery_already_used'
      ? '差分レビューが再び計画外混入で不合格（worktree再構築の上限到達）'
      : 'worktree再構築リカバリが失敗しました';
  const blockedMessage =
    recoveryReason === 'recovery_already_used'
      ? `タスク #${taskId} はブランチ履歴汚染による worktree 再構築を既に1回実施済みですが、再度計画外混入が検出されました。手動確認が必要です。`
      : `タスク #${taskId} の worktree 再構築中にパッチ適用が失敗しました。退避タグ（recovery/task-${taskId}-*）から手動復旧してください。`;
  // Dynamic import mirrors this handler's convention — keeps the
  // static graph free of config/database for test isolation.
  const { writeBlockedStatusDurable } =
    await import('../../../../services/workflow/durable-blocked-write');
  await writeBlockedStatusDurable({
    taskId,
    log,
    source: 'Workflow',
    notification: { title: blockedTitle, message: blockedMessage },
  });
  const { notifyRecoveryFallbackBlocked } =
    await import('../../../../services/workflow/worktree-rebuild-recovery');
  await notifyRecoveryFallbackBlocked(taskId, blockedTitle, blockedMessage);
  await markLatestExecutionFailed(taskId, reason);
  await recordTransition({
    taskId,
    fromStatus,
    toStatus: fromStatus,
    actor: 'system',
    cause: 'adversarial_review_failed',
    phase: 'verify',
    metadata: {
      severity: review.severity,
      reasons: review.reasons.slice(0, 5),
      findings: capFindingsForStorage(review.findings),
      recoveryOutcome: recoveryReason,
      recoveryExhausted: recoveryReason === 'recovery_already_used',
    },
    invariantViolation: true,
    invariantMessage: reason,
  }).catch(() => {});
  log.warn(
    { taskId, recoveryReason, severity: review.severity },
    '[Workflow] History-contamination recovery unavailable — task blocked (no implementer bounce)',
  );
  return { stale: false };
}
