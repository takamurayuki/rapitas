/**
 * blocked-task-escalation
 *
 * One-shot escalation for blocked tasks excluded from blind auto-retry
 * (task 615), followed by a periodic re-escalation for whatever the one-shot
 * leaves unresolved (task 703 — the one-shot alone let task 666 sit silent
 * for 39 hours): says WHAT is needed (human answer / task split / manual
 * investigation), records it durably, and never repeats within the same
 * window. The permanent idempotency gate is a `blocked_escalated`
 * WorkflowTransition row — unread notification dedup alone re-fires after the
 * user reads (and that was the "abandoned blocked tasks" hole). Not
 * responsible for deciding WHO is excluded — that is blocked-task-policy's
 * classification.
 */
import type { PrismaClient } from '../../generated/prisma-postgres';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
import { submitConcern } from '../memory/concern-backlog-service';
import { resolveSelfDevelopmentThemeId } from './self-development-theme';
import type { BlockedExclusionReason } from './blocked-task-policy';
import { BLOCKED_REESCALATION_INTERVAL_MS } from './blocked-task-policy';
import { buildNotificationI18n } from '../communication/notification-i18n';

type PrismaClientInstance = InstanceType<typeof PrismaClient>;

const log = createLogger('blocked-task-escalation');

/** Transition cause that permanently marks a task as escalated. */
export const BLOCKED_ESCALATED_CAUSE = 'blocked_escalated';

/**
 * Transition cause recorded for each periodic re-escalation past the first.
 * Deliberately distinct from {@link BLOCKED_ESCALATED_CAUSE} so the permanent
 * one-shot gate in {@link escalateBlockedTask} stays untouched — re-escalation
 * is a separate, repeatable mechanism layered next to it, not a change to it.
 */
export const BLOCKED_REESCALATED_CAUSE = 'blocked_reescalated';

/** Per-reason copy: what the human/system must do next. */
const REASON_COPY: Record<BlockedExclusionReason, { needs: string; notificationType: string }> = {
  awaiting_question: {
    needs: '質問への回答が必要です。回答するまでこのタスクは再開されません。',
    notificationType: 'blocked_escalation_needs_answer',
  },
  verify_repair_exhausted: {
    needs: '検証修復の予算を使い切りました。タスクの分割が必要です。',
    notificationType: 'blocked_escalation',
  },
  verify_no_convergence: {
    needs:
      '差し戻しが収束していません（同一の受入基準が繰り返し未対応）。タスク分割または仕様の見直しが必要です。',
    notificationType: 'blocked_escalation',
  },
  retry_cap_exhausted: {
    needs: '自動再試行の上限に達しました。手動での調査が必要です。',
    notificationType: 'blocked_escalation',
  },
  pr_recovery_exhausted: {
    needs:
      'PR作成の自動復旧（軽量リトライ）を繰り返しても PR を作成できませんでした。GitHub 連携・権限・リポジトリ状態の手動確認が必要です。',
    notificationType: 'blocked_escalation',
  },
  abandoned_old: {
    needs: '長期間放置されています（自動再試行の対象期間外）。手動での調査が必要です。',
    notificationType: 'blocked_escalation',
  },
};

/**
 * Escalate one excluded blocked task, exactly once per task.
 *
 * Path by reason: `awaiting_question` → notification only (a human answer is
 * required; a concern would file a task no agent can resolve — mirrors
 * self-incident-watcher's policy). All other reasons → self-development
 * concern (dedupKey-permanent) + notification. Ends by recording the
 * `blocked_escalated` transition that gates every later call.
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param task - Blocked task (id/title/themeId). / 対象タスク
 * @param reason - Exclusion classification. / 除外理由
 * @param nowMs - Current time (ms). / 現在時刻
 * @param detail - Case-specific evidence appended to the notification message
 *          and the concern detail (e.g. which criterion was flagged how many
 *          times — the static REASON_COPY cannot carry that). / 個別根拠文
 * @returns true when escalated now; false when already escalated (or the
 *          idempotency check failed — fail-closed against duplicates). / 実施有無
 */
export async function escalateBlockedTask(
  prisma: PrismaClientInstance,
  task: { id: number; title: string; themeId: number | null },
  reason: BlockedExclusionReason,
  nowMs: number,
  detail?: string,
): Promise<boolean> {
  // Permanent idempotency gate. A count failure escalates NOTHING — repeating
  // a notification is worse than deferring it to the next cycle.
  let already: number;
  try {
    already = await prisma.workflowTransition.count({
      where: { taskId: task.id, cause: BLOCKED_ESCALATED_CAUSE },
    });
  } catch {
    return false;
  }
  if (already >= 1) return false;

  const copy = REASON_COPY[reason];

  // Best-effort side effects: a notification/concern failure must not abort
  // the escalation — the transition below still marks it handled, and the
  // concern path has its own permanent dedupKey. The row is created directly
  // (auto-run-notifications pattern): createNotification's NotificationType
  // union doesn't carry these escalation-specific types.
  try {
    await prisma.notification.create({
      data: {
        type: copy.notificationType,
        title: 'ブロックされたタスクが対応待ちです',
        message: `#${task.id}「${task.title}」は自動再試行の対象外です（理由: ${reason}）。${copy.needs}${detail ? ` ${detail}` : ''}`,
        link: `/tasks?taskId=${task.id}`,
        metadata: JSON.stringify({
          taskId: task.id,
          reason,
          source: 'blocked_escalation',
          i18n: buildNotificationI18n('blocked_escalation', {
            taskId: task.id,
            taskTitle: task.title,
            reason,
            detail: detail ? ` ${detail}` : '',
          }),
        }),
      },
    });
  } catch (err) {
    log.warn({ err, taskId: task.id, reason }, '[blocked-escalation] notification failed');
  }

  if (reason !== 'awaiting_question') {
    try {
      const selfThemeId = await resolveSelfDevelopmentThemeId();
      await submitConcern({
        ...(selfThemeId != null ? { themeId: selfThemeId } : {}),
        title: `blocked タスク #${task.id} が自動再試行の対象外のまま滞留`,
        detail: [
          `タスク #${task.id}「${task.title}」が status=blocked のまま自動再試行から除外されています。`,
          `除外理由: ${reason} — ${copy.needs}`,
          ...(detail ? [detail] : []),
          `検出時刻: ${new Date(nowMs).toISOString()}`,
          '成功証拠（PR実在）は確認できなかったため、done への自動是正は行っていません。',
        ].join('\n'),
        type: 'other',
        severity: 'medium',
        originTaskId: task.id,
        source: 'blocked_escalation',
        dedupKey: `blocked-escalation:${reason}:${task.id}`,
      });
    } catch (err) {
      log.warn({ err, taskId: task.id, reason }, '[blocked-escalation] concern filing failed');
    }
  }

  await recordTransition({
    taskId: task.id,
    fromStatus: 'blocked',
    toStatus: 'blocked',
    actor: 'system',
    cause: BLOCKED_ESCALATED_CAUSE,
    metadata: { reason },
  }).catch(() => {});
  log.info({ taskId: task.id, reason }, '[blocked-escalation] escalated blocked task (once)');
  return true;
}

/**
 * Re-notify for a blocked task that is STILL unresolved a full
 * {@link BLOCKED_REESCALATION_INTERVAL_MS} after its most recent escalation
 * (first `blocked_escalated` or a prior `blocked_reescalated`). Unlike
 * {@link escalateBlockedTask} this is not a permanent one-shot gate — it fires
 * again every time the interval elapses, bounding how long a task can sit
 * silently blocked (task 703: task 666 went 39 hours unresolved past its one
 * escalation). Notification only — no concern re-filing, since the original
 * escalation's concern already exists under a permanent dedupKey and re-filing
 * would double up on that mechanism (plan.md §設計判断の根拠).
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param task - Blocked task (id/title/themeId). / 対象タスク
 * @param reason - Exclusion classification (reused for notification copy). / 除外理由
 * @param nowMs - Current time (ms). / 現在時刻
 * @param thresholdMs - Re-escalation interval, injectable for tests. / 再エスカレーション間隔
 * @returns true when re-escalated now; false when not yet due (or the lookup
 *          failed — fail-closed, matching escalateBlockedTask). / 実施有無
 */
export async function reescalateIfOverdue(
  prisma: PrismaClientInstance,
  task: { id: number; title: string; themeId: number | null },
  reason: BlockedExclusionReason,
  nowMs: number,
  thresholdMs: number = BLOCKED_REESCALATION_INTERVAL_MS,
): Promise<boolean> {
  let last: { createdAt: Date } | null;
  try {
    last = await prisma.workflowTransition.findFirst({
      where: {
        taskId: task.id,
        cause: { in: [BLOCKED_ESCALATED_CAUSE, BLOCKED_REESCALATED_CAUSE] },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
  } catch {
    return false;
  }
  // No prior escalation at all means the one-shot gate hasn't fired yet this
  // cycle (or ever) — that path owns the first notification, not this one.
  if (!last) return false;
  const elapsedMs = nowMs - last.createdAt.getTime();
  if (elapsedMs < thresholdMs) return false;

  const copy = REASON_COPY[reason];
  const hours = Math.floor(elapsedMs / (60 * 60 * 1000));
  try {
    await prisma.notification.create({
      data: {
        type: copy.notificationType,
        title: 'ブロックされたタスクが対応待ちです（継続）',
        message: `#${task.id}「${task.title}」はエスカレーション後も${hours}時間解決されていません（理由: ${reason}）。${copy.needs}`,
        link: `/tasks?taskId=${task.id}`,
        metadata: JSON.stringify({
          taskId: task.id,
          reason,
          source: 'blocked_reescalation',
          i18n: buildNotificationI18n('blocked_escalation_reescalated', {
            taskId: task.id,
            taskTitle: task.title,
            reason,
            hours,
          }),
        }),
      },
    });
  } catch (err) {
    log.warn({ err, taskId: task.id, reason }, '[blocked-escalation] re-notification failed');
  }

  await recordTransition({
    taskId: task.id,
    fromStatus: 'blocked',
    toStatus: 'blocked',
    actor: 'system',
    cause: BLOCKED_REESCALATED_CAUSE,
    metadata: { reason },
  }).catch(() => {});
  log.info(
    { taskId: task.id, reason, hours },
    '[blocked-escalation] re-escalated overdue blocked task',
  );
  return true;
}

/**
 * Count blocked tasks that have been escalated and still await attention —
 * the "対応待ちの blocked タスク" number (task 615 requirement 2: the abandoned
 * set must be countable without new schema).
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @returns Number of still-blocked escalated tasks. / 対応待ちblocked件数
 */
export async function countEscalatedBlocked(prisma: PrismaClientInstance): Promise<number> {
  try {
    const rows = await prisma.workflowTransition.findMany({
      where: { cause: BLOCKED_ESCALATED_CAUSE },
      select: { taskId: true },
      distinct: ['taskId'],
    });
    const ids = rows.map((r) => r.taskId).filter((id): id is number => id != null);
    if (ids.length === 0) return 0;
    return await prisma.task.count({ where: { id: { in: ids }, status: 'blocked' } });
  } catch {
    return 0;
  }
}
