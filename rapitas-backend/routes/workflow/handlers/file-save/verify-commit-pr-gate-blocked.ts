/**
 * FileSave Verify Commit/PR — Gate-Blocked Handling
 *
 * Handles the verification-gate failure branch of the verify completion stage:
 * history-contamination recovery exhaustion (block + notify), the self-repair
 * bounce back to the implementer, and repair exhaustion (stay blocked).
 * Not responsible for running the gate or the completion writes themselves.
 */

import { prisma } from '../../../../config';
import { createLogger } from '../../../../config/logger';
import { recordTransition } from '../../../../services/workflow/transition-recorder';
import { markLatestExecutionFailed } from './shared';

const log = createLogger('routes:workflow:handlers:files');

/** Recorded when a gate fails with the same signature that already bounced once. */
export const VERIFY_GATE_REPEAT_HOLD_CAUSE = 'verification_gate_repeat_hold';

/** The comparable part of a gate reason: the check summary, not the prose around it. */
export function gateFailureSignature(reason: string): string {
  return (reason.match(/自動検証に失敗しました（(.+?)）/)?.[1] ?? reason)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find the latest verify_repair bounce in the current repair window whose
 * recorded reason has the same signature as this failure. Bouncing again on
 * an identical verdict only spends budget (2026-09-13: 905/912 re-ran the
 * implementer for runtime=UNVERIFIED it could not influence).
 *
 * @param taskId - Task being evaluated / 対象タスク
 * @param gateReason - This run's gate failure reason / 今回の失敗理由
 * @returns The matching prior bounce, or null / 一致した過去の差し戻し
 */
export async function findRepeatedGateFailure(
  taskId: number,
  gateReason: string,
): Promise<{ attempt: number | null; at: Date } | null> {
  const { resolveRepairWindowStart } =
    await import('../../../../services/workflow/verify-self-repair-budget');
  const windowStart = await resolveRepairWindowStart(taskId).catch(() => null);
  const prior = await prisma.workflowTransition
    .findFirst({
      where: {
        taskId,
        cause: 'verify_repair',
        ...(windowStart ? { createdAt: { gte: windowStart } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { metadata: true, createdAt: true },
    })
    .catch(() => null);
  if (!prior?.metadata) return null;
  let meta: { reason?: unknown; attempt?: unknown } = {};
  try {
    meta = JSON.parse(String(prior.metadata)) as typeof meta;
  } catch {
    return null;
  }
  if (typeof meta.reason !== 'string') return null;
  if (gateFailureSignature(meta.reason) !== gateFailureSignature(gateReason)) return null;
  return { attempt: typeof meta.attempt === 'number' ? meta.attempt : null, at: prior.createdAt };
}

/**
 * Handles a verification-gate failure for a verify.md save: block directly when
 * contamination recovery is unavailable, otherwise bounce to self-repair.
 *
 * @param params - taskId / gate failure reason / recovery-block reason / verify content / 入力一式
 * @returns The bounced workflow status when the self-repair rollback applied, otherwise undefined / 差し戻し時の新ステータス（適用時のみ）
 */
export async function handleVerifyGateBlocked(params: {
  taskId: number;
  gateReason: string;
  gateRecoveryBlocked: 'recovery_already_used' | 'patch_apply_conflict' | null;
  savedContent: string;
}): Promise<{ newStatus?: string }> {
  const { taskId, gateReason, gateRecoveryBlocked, savedContent } = params;

  if (gateRecoveryBlocked) {
    // Contamination recovery exhausted (受入基準3) or failed after the old
    // worktree was destroyed (受入基準2c) — an implementer bounce is
    // futile/impossible; block + notify directly, skipping self-repair.
    const blockedTitle =
      gateRecoveryBlocked === 'recovery_already_used'
        ? '自動検証ゲートが再び計画外混入で失敗（worktree再構築の上限到達）'
        : 'worktree再構築リカバリが失敗しました';
    const blockedMessage =
      gateRecoveryBlocked === 'recovery_already_used'
        ? `タスク #${taskId} はブランチ履歴汚染による worktree 再構築を既に1回実施済みですが、自動検証ゲートが再度失敗しました。手動確認が必要です。`
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
    await markLatestExecutionFailed(taskId, gateReason);
    await recordTransition({
      taskId,
      fromStatus: 'verify_done',
      toStatus: 'verify_done',
      actor: 'system',
      cause: 'verification_gate_failed',
      phase: 'verify',
      metadata: {
        reason: gateReason,
        recoveryOutcome: gateRecoveryBlocked,
        recoveryExhausted: gateRecoveryBlocked === 'recovery_already_used',
      },
      invariantViolation: true,
      invariantMessage: gateReason,
    }).catch(() => {});
    log.warn(
      { taskId, recoveryReason: gateRecoveryBlocked, reason: gateReason },
      '[Workflow] History-contamination recovery unavailable — task blocked, no commit/PR',
    );
    return {};
  }

  // Same failure as the last bounce → hold with the saved commit and this
  // diagnosis instead of re-running the implementer on an identical verdict.
  const repeated = await findRepeatedGateFailure(taskId, gateReason).catch(() => null);
  if (repeated) {
    const { writeBlockedStatusDurable } =
      await import('../../../../services/workflow/durable-blocked-write');
    await writeBlockedStatusDurable({
      taskId,
      log,
      source: 'Workflow',
      notification: {
        title: '自動検証が同じ理由で再度失敗したため保留にしました',
        message: `タスク #${taskId}: 前回の差し戻し（attempt ${repeated.attempt ?? '?'}）と同じ検証失敗です。ローカルコミットと診断を保持し、実装者の再実行は行いません。${gateReason}`,
      },
    });
    await markLatestExecutionFailed(taskId, gateReason);
    await recordTransition({
      taskId,
      fromStatus: 'verify_done',
      toStatus: 'verify_done',
      actor: 'system',
      cause: VERIFY_GATE_REPEAT_HOLD_CAUSE,
      phase: 'verify',
      metadata: { reason: gateReason, priorAttempt: repeated.attempt, priorAt: repeated.at },
    }).catch(() => {});
    log.warn(
      { taskId, priorAttempt: repeated.attempt, reason: gateReason },
      '[Workflow] Verification gate failed with the same signature as the last bounce — holding, no implementer re-run',
    );
    return {};
  }

  const { attemptVerifyRepair } = await import('../../../../services/workflow/verify-self-repair');
  const repair = await attemptVerifyRepair(taskId, 'verify_done', gateReason, savedContent).catch(
    () => ({ bounced: false }) as Awaited<ReturnType<typeof attemptVerifyRepair>>,
  );

  if (repair.bounced && repair.newStatus) {
    // Compare-and-swap: performAutoCommitAndPR ran real git/lint/test
    // subprocesses above and can take a while — if a concurrent request
    // for this same task (e.g. a duplicate/retried save) already moved
    // the task past verify_done in the meantime, an unconditional update
    // here would stomp that newer state back to the implementer entry.
    // Mirrors the same guard on the adversarial-review bounce above.
    const rolled = await prisma.task
      .updateMany({
        where: { id: taskId, workflowStatus: 'verify_done' },
        data: { workflowStatus: repair.newStatus },
      })
      .catch(() => ({ count: 0 }));
    if (rolled.count === 0) {
      log.warn(
        { taskId, attempt: repair.attempt, reason: gateReason },
        '[Workflow] Verification gate failed but the workflow already moved on — skipping rollback',
      );
      return {};
    }
    log.warn(
      { taskId, attempt: repair.attempt, reason: gateReason },
      '[Workflow] Verification gate failed — bounced to implementer for self-repair',
    );
    return { newStatus: repair.newStatus };
  }
  if (repair.stale) {
    log.warn(
      { taskId, reason: gateReason },
      '[Workflow] stale verification-gate failure — workflow moved on; neither bouncing nor blocking',
    );
    return {};
  }
  await markLatestExecutionFailed(taskId, gateReason);
  log.warn(
    { taskId, reason: gateReason },
    '[Workflow] Verification gate failed and self-repairs exhausted — task stays blocked, no commit/PR.',
  );
  return {};
}
