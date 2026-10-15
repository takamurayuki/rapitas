/**
 * auto-run-notifications-shared
 *
 * Shared plumbing for auto-run notifications: the dedup-on-create helper
 * (notifyOnce) and the task-title lookup used by copy across notification
 * types. Split out of auto-run-notifications.ts (task 784) to stay under the
 * file-size ratchet; auto-run-notifications.ts re-exports this as a barrel.
 */
import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';
import { type NotificationI18n } from '../../communication/notification-i18n';

const log = createLogger('auto-run-notifications');

export interface NotifyParams {
  type: string;
  // NOTE: nullable — WorkflowQueueItem.themeId is nullable (legacy rows,
  // subtask-split items) and queue-wide starvation is not theme-scoped (task 618).
  themeId: number | null;
  taskId?: number;
  title: string;
  message: string;
  link?: string;
  /** i18n pointer for locale-aware re-translation — see notification-i18n.ts. */
  i18n?: NotificationI18n;
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
export async function notifyOnce(params: NotifyParams): Promise<void> {
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
          ...(params.i18n ? { i18n: params.i18n } : {}),
        }),
      },
    });
  } catch (err) {
    log.warn({ err, type: params.type }, '[autoRunNotify] Failed to create notification');
  }
}

/** Fetch a task title for notification copy; falls back to the id. */
export async function taskLabel(taskId: number): Promise<string> {
  const task = await prisma.task
    .findUnique({ where: { id: taskId }, select: { title: true } })
    .catch(() => null);
  return task?.title ?? `タスク ${taskId}`;
}
