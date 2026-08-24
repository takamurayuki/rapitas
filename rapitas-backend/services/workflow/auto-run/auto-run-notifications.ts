/**
 * auto-run-notifications
 *
 * Notification records for theme auto-run lifecycle events that need USER
 * attention (approval gates, unanswered questions, failures, completion).
 * The scheduler only broadcasts SSE — invisible unless the user is watching
 * that screen — so these persist to the Notification table the header bell
 * and browser notifications read. Deduplicated: an UNREAD notification of the
 * same type for the same task/theme suppresses re-sending (the 12 s scheduler
 * tick would otherwise re-fire every pass through a held state).
 */
import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';

const log = createLogger('auto-run-notifications');

interface NotifyParams {
  type: string;
  // NOTE: nullable — WorkflowQueueItem.themeId is nullable (legacy rows,
  // subtask-split items) and queue-wide starvation is not theme-scoped (task 618).
  themeId: number | null;
  taskId?: number;
  title: string;
  message: string;
  link?: string;
}

/** Dedup scope: task id when known, else theme, else a queue-global bucket. */
function dedupScope(params: Pick<NotifyParams, 'themeId' | 'taskId'>): string | number {
  return params.taskId ?? (params.themeId != null ? `theme-${params.themeId}` : 'global');
}

/**
 * Create an auto-run notification unless an unread one of the same type for
 * the same task/theme already exists. Best-effort: failures are logged and
 * swallowed — a notification problem must never affect scheduling.
 *
 * @param params - Notification type, scope (theme/task), and content. / 通知内容
 */
async function notifyOnce(params: NotifyParams): Promise<void> {
  try {
    const dedupKey = `"dedupKey":"${params.type}:${dedupScope(params)}"`;
    const existing = await prisma.notification.findFirst({
      where: {
        type: params.type,
        isRead: false,
        metadata: { contains: dedupKey },
      },
      select: { id: true },
    });
    if (existing) return;

    await prisma.notification.create({
      data: {
        type: params.type,
        title: params.title,
        message: params.message,
        link: params.link ?? (params.taskId ? `/tasks/${params.taskId}` : null),
        // metadata is a JSON string; embed the dedup key as a real field so the
        // contains-match above cannot collide with other metadata content.
        metadata: JSON.stringify({
          dedupKey: `${params.type}:${dedupScope(params)}`,
          themeId: params.themeId,
          taskId: params.taskId ?? null,
        }),
      },
    });
  } catch (err) {
    log.warn({ err, type: params.type }, '[autoRunNotify] Failed to create notification');
  }
}

/** Fetch a task title for notification copy; falls back to the id. */
async function taskLabel(taskId: number): Promise<string> {
  const task = await prisma.task
    .findUnique({ where: { id: taskId }, select: { title: true } })
    .catch(() => null);
  return task?.title ?? `タスク ${taskId}`;
}

/** Auto-run paused: a plan is waiting for the user's approval. */
export async function notifyAwaitingPlanApproval(themeId: number, taskId: number): Promise<void> {
  await notifyOnce({
    type: 'auto_run_awaiting_approval',
    themeId,
    taskId,
    title: '自動実行: 計画の承認待ち',
    message: `「${await taskLabel(taskId)}」の実装計画が承認待ちです。承認するまで自動実行は一時停止します。`,
  });
}

/** Auto-run held: the agent asked a question and is waiting for an answer. */
export async function notifyAwaitingUserAnswer(themeId: number, taskId: number): Promise<void> {
  await notifyOnce({
    type: 'auto_run_awaiting_answer',
    themeId,
    taskId,
    title: '自動実行: エージェントが回答を待っています',
    message: `「${await taskLabel(taskId)}」のエージェントが質問への回答を待っています。回答するまでこのテーマの自動実行は停止したままです。`,
  });
}

/** A task exceeded its wall-clock budget and was force-stopped by the hang backstop. */
export async function notifyHangBackstop(
  themeId: number,
  taskId: number,
  wallMinutes: number,
): Promise<void> {
  await notifyOnce({
    type: 'auto_run_hang_backstop',
    themeId,
    taskId,
    title: '自動実行: タスクが時間上限で停止しました',
    message: `タスク #${taskId}「${await taskLabel(taskId)}」が時間上限（${wallMinutes}分）を超えたため停止しました — ログを確認して再実行してください。`,
  });
}

/** A task failed/was blocked and auto-run skipped it. */
export async function notifyTaskSkipped(
  themeId: number,
  taskId: number,
  reason: string,
): Promise<void> {
  await notifyOnce({
    type: 'auto_run_task_skipped',
    themeId,
    taskId,
    title: '自動実行: タスクをスキップしました',
    message: `「${await taskLabel(taskId)}」が失敗またはブロックされたためスキップしました: ${reason}`,
  });
}

/**
 * The theme is WEDGED: work exists but every remaining task is blocked
 * (task 615). Deliberately a different type + copy from notifyAllDone so a
 * dead loop is never read as a normal "all finished" idle.
 *
 * @param themeId - Theme that went idle while wedged. / 対象テーマ
 * @param blockedCount - Blocked tasks remaining. / blockedタスク件数
 * @param escalatedCount - Of those, already escalated (awaiting attention). / エスカレーション済み件数
 */
export async function notifyAllBlocked(
  themeId: number,
  blockedCount: number,
  escalatedCount: number,
): Promise<void> {
  const theme = await prisma.theme
    .findUnique({ where: { id: themeId }, select: { name: true } })
    .catch(() => null);
  await notifyOnce({
    type: 'auto_run_all_blocked',
    themeId,
    title: '自動実行: 実行可能なタスクがすべてブロックされています',
    message: `テーマ「${theme?.name ?? themeId}」は完了ではなく閉塞しています: blocked タスクが ${blockedCount} 件残っています（うち対応待ちエスカレーション ${escalatedCount} 件）。回答・分割・調査など人の対応が必要です。`,
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
  await notifyOnce({
    type: 'auto_run_stall_released',
    themeId,
    taskId,
    title: '自動実行: 停滞していたキュー項目を自動解除しました',
    message: `タスク #${taskId}「${await taskLabel(taskId)}」に残留していたキュー項目 ${releasedCount} 件を自動解除しました（理由: ${cause}）。自動実行は次のタスクへ進みます。`,
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
  await notifyOnce({
    type: 'auto_run_queue_starved',
    themeId: null,
    taskId: taskId ?? undefined,
    title: '自動実行: キューが消費されていません',
    message: `実行中 0 件のままキュー待ちが約 ${waitedMinutes} 分間消費されませんでした${
      taskId != null ? `（先頭: タスク #${taskId}）` : ''
    }。ワークフローランナーを再起動して消費を再開させました。`,
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
  await notifyOnce({
    type: 'auto_run_zero_progress',
    themeId,
    taskId,
    title: '自動実行: 実行が進んでいません（空回りの疑い）',
    message: `テーマは running を報告し続けていますが、タスク #${taskId}「${await taskLabel(
      taskId,
    )}」の実行（AgentExecution）が ${elapsedMinutes} 分間 1件も作成されていません。enqueue→cancel の反復など、実行が空回りしている可能性があります。`,
  });
}

/** All tasks for the theme are done; auto-run went idle. */
export async function notifyAllDone(themeId: number): Promise<void> {
  const theme = await prisma.theme
    .findUnique({ where: { id: themeId }, select: { name: true } })
    .catch(() => null);
  await notifyOnce({
    type: 'auto_run_all_done',
    themeId,
    title: '自動実行: すべてのタスクが完了',
    message: `テーマ「${theme?.name ?? themeId}」の対象タスクをすべて処理しました。自動実行を終了します。`,
  });
}
