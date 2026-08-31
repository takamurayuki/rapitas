/**
 * auto-run-notifications-hold
 *
 * Notifications for hold/skip states during auto-run: approval/answer waits,
 * hang backstop, skipped/vanished tasks, queue stalls and starvation,
 * zero-progress spin, and resource-contention holds. Split out of
 * auto-run-notifications.ts (task 784) to stay under the file-size ratchet;
 * auto-run-notifications.ts re-exports this as a barrel. See
 * auto-run-notifications-terminal.ts for completion/idle-stop notifications.
 */
import { prisma } from '../../../config';
import { buildNotificationI18n } from '../../communication/notification-i18n';
import { notifyOnce, taskLabel } from './auto-run-notifications-shared';
import { MAX_BLOCKED_RETRY } from '../blocked-task-policy';

/** Auto-run paused: a plan is waiting for the user's approval. */
export async function notifyAwaitingPlanApproval(themeId: number, taskId: number): Promise<void> {
  const label = await taskLabel(taskId);
  await notifyOnce({
    type: 'auto_run_awaiting_approval',
    themeId,
    taskId,
    title: '自動実行: 計画の承認待ち',
    message: `「${label}」の実装計画が承認待ちです。承認するまで自動実行は一時停止します。`,
    i18n: buildNotificationI18n('auto_run_awaiting_approval', { taskLabel: label }),
  });
}

/** Auto-run held: the agent asked a question and is waiting for an answer. */
export async function notifyAwaitingUserAnswer(themeId: number, taskId: number): Promise<void> {
  const label = await taskLabel(taskId);
  await notifyOnce({
    type: 'auto_run_awaiting_answer',
    themeId,
    taskId,
    title: '自動実行: エージェントが回答を待っています',
    message: `「${label}」のエージェントが質問への回答を待っています。回答するまでこのテーマの自動実行は停止したままです。`,
    i18n: buildNotificationI18n('auto_run_awaiting_answer', { taskLabel: label }),
  });
}

/** A task exceeded its wall-clock budget and was force-stopped by the hang backstop. */
export async function notifyHangBackstop(
  themeId: number,
  taskId: number,
  wallMinutes: number,
): Promise<void> {
  const label = await taskLabel(taskId);
  await notifyOnce({
    type: 'auto_run_hang_backstop',
    themeId,
    taskId,
    title: '自動実行: タスクが時間上限で停止しました',
    message: `タスク #${taskId}「${label}」が時間上限（${wallMinutes}分）を超えたため停止しました。このテーマで自動実行が有効であれば、自動再試行の残り回数がある限り数分以内に自動的に再試行されます（上限${MAX_BLOCKED_RETRY}回）。今すぐ手動で再実行すると、その自動再試行の機会を1回消費します — 緊急でなければログの確認だけにとどめ、自動再試行の結果を待ってください。`,
    i18n: buildNotificationI18n('auto_run_hang_backstop', {
      taskId,
      taskLabel: label,
      wallMinutes,
      maxBlockedRetry: MAX_BLOCKED_RETRY,
    }),
  });
}

/** A task failed/was blocked and auto-run skipped it. */
export async function notifyTaskSkipped(
  themeId: number,
  taskId: number,
  reason: string,
): Promise<void> {
  const label = await taskLabel(taskId);
  await notifyOnce({
    type: 'auto_run_task_skipped',
    themeId,
    taskId,
    title: '自動実行: タスクをスキップしました',
    message: `「${label}」が失敗またはブロックされたためスキップしました: ${reason}`,
    i18n: buildNotificationI18n('auto_run_task_skipped', { taskLabel: label, reason }),
  });
}

/**
 * A task's row is confirmed absent (deleted, or never persisted past enqueue)
 * — distinct from notifyTaskSkipped's "failed/blocked" framing, which is
 * inaccurate for a task that no longer exists (task 651). Does NOT call
 * taskLabel(taskId): the row does not exist, so that lookup would only add a
 * wasted query before falling back to the same `#${taskId}` string anyway.
 */
export async function notifyTaskVanished(themeId: number, taskId: number): Promise<void> {
  await notifyOnce({
    type: 'auto_run_task_vanished',
    themeId,
    taskId,
    title: '自動実行: タスクが見つかりませんでした',
    message: `タスク #${taskId} の行が見つからないため、自動実行はこのタスクをスキップして次へ進みます。`,
    i18n: buildNotificationI18n('auto_run_task_vanished', { taskId }),
  });
}

/** Reason code for a released queue-item residue (task 618). */
export type StallReleaseCause =
  | 'terminal_task_active_item_residue'
  | 'terminal_task_running_residue'
  | 'stale_running_no_live_execution';

/**
 * Queue-item residue pinning a task was auto-released (task 618): either the
 * scheduler freed a TERMINAL current task's leftover items, or the reconciler
 * swept a stale 'running' item nobody else would ever reclaim.
 *
 * @param themeId - Theme of the released item, if scoped. / 対象テーマ（null可）
 * @param taskId - Task whose residue was released. / 対象タスク
 * @param releasedCount - Items cancelled by this release. / 解除件数
 * @param cause - Machine-readable release reason. / 解除理由コード
 */
export async function notifyStallReleased(
  themeId: number | null,
  taskId: number,
  releasedCount: number,
  cause: StallReleaseCause,
): Promise<void> {
  const label = await taskLabel(taskId);
  await notifyOnce({
    type: 'auto_run_stall_released',
    themeId,
    taskId,
    title: '自動実行: 停滞していたキュー項目を自動解除しました',
    message: `タスク #${taskId}「${label}」に残留していたキュー項目 ${releasedCount} 件を自動解除しました（理由: ${cause}）。自動実行は次のタスクへ進みます。`,
    i18n: buildNotificationI18n('auto_run_stall_released', {
      taskId,
      taskLabel: label,
      releasedCount,
      cause,
    }),
  });
}

/**
 * The queue is STARVED: `running=0 かつ queued>0` persisted past the threshold
 * (task 618, 事例1). The runner was kicked with startProcessing(); this
 * notification makes the formerly-silent stall visible.
 *
 * @param taskId - Oldest queued task, if any. / 最古の待機タスク（null可）
 * @param waitedMinutes - How long the starvation persisted. / 継続時間（分）
 */
export async function notifyQueueStarvation(
  taskId: number | null,
  waitedMinutes: number,
): Promise<void> {
  const taskRef = taskId != null ? `（先頭: タスク #${taskId}）` : '';
  await notifyOnce({
    type: 'auto_run_queue_starved',
    themeId: null,
    taskId: taskId ?? undefined,
    title: '自動実行: キューが消費されていません',
    message: `実行中 0 件のままキュー待ちが約 ${waitedMinutes} 分間消費されませんでした${taskRef}。ワークフローランナーを再起動して消費を再開させました。`,
    i18n: buildNotificationI18n('auto_run_queue_starved', { waitedMinutes, taskRef }),
  });
}

/**
 * The theme is SPINNING: it keeps reporting status='running' but its current
 * task has produced ZERO AgentExecution rows for the whole threshold window
 * (task 653: 21 min of enqueue→cancel looked healthy on every self-report).
 * Notify-only backstop — self-healing stays with hasRunawayCancelLoop.
 *
 * @param themeId - Theme reporting running with no progress. / 対象テーマ
 * @param taskId - Current task with zero executions. / 実行ゼロのカレントタスク
 * @param elapsedMinutes - How long the zero-progress state persisted. / 継続時間（分）
 */
export async function notifyZeroProgressWhileRunning(
  themeId: number,
  taskId: number,
  elapsedMinutes: number,
): Promise<void> {
  const label = await taskLabel(taskId);
  await notifyOnce({
    type: 'auto_run_zero_progress',
    themeId,
    taskId,
    title: '自動実行: 実行が進んでいません（空回りの疑い）',
    message: `テーマは running を報告し続けていますが、タスク #${taskId}「${label}」の実行（AgentExecution）が ${elapsedMinutes} 分間 1件も作成されていません。enqueue→cancel の反復など、実行が空回りしている可能性があります。`,
    i18n: buildNotificationI18n('auto_run_zero_progress', {
      taskId,
      taskLabel: label,
      elapsedMinutes,
    }),
  });
}

/**
 * Auto-run held next-task selection for one cycle: the host CPU is busy AND
 * the run is intentionally parallelized (task 725, RAPITAS_RESOURCE_GATE_ENABLED).
 * The busy% reported is HOST-WIDE, not attributable to this theme specifically
 * — the copy says so to avoid a false impression of per-theme blame.
 *
 * @param themeId - Theme whose next-task selection was held. / 対象テーマ
 * @param cpuBusyPercent - Host CPU busy percentage at decision time. / ホストCPU使用率(%)
 * @param thresholdPercent - Configured hold threshold. / しきい値(%)
 */
export async function notifyResourceContentionHold(
  themeId: number,
  cpuBusyPercent: number,
  thresholdPercent: number,
): Promise<void> {
  const theme = await prisma.theme
    .findUnique({ where: { id: themeId }, select: { name: true } })
    .catch(() => null);
  const themeName = theme?.name ?? String(themeId);
  const cpuBusyRounded = Math.round(cpuBusyPercent);
  await notifyOnce({
    type: 'auto_run_resource_hold',
    themeId,
    title: '自動実行: リソース逼迫のため次タスクの着手を見送りました',
    message: `テーマ「${themeName}」の次タスク着手を1サイクル見送りました（ホスト全体のCPU使用率 ${cpuBusyRounded}% がしきい値 ${thresholdPercent}% を超過）。次回のスケジューラtickで再評価します。ダッシュボードから今すぐ実行できます。`,
    i18n: buildNotificationI18n('auto_run_resource_hold', {
      themeName,
      cpuBusyPercent: cpuBusyRounded,
      thresholdPercent,
    }),
  });
}
