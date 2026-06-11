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
  themeId: number;
  taskId?: number;
  title: string;
  message: string;
  link?: string;
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
    const dedupKey = `"dedupKey":"${params.type}:${params.taskId ?? `theme-${params.themeId}`}"`;
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
          dedupKey: `${params.type}:${params.taskId ?? `theme-${params.themeId}`}`,
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
