/**
 * auto-merge-notify
 *
 * Deduplicated user notifications for auto-merge outcomes. NOT responsible for
 * deciding outcomes — only for creating the Notification rows with a cooldown.
 */
import { prisma } from '../../config/database';

/**
 * Dedup window for "保留" notifications. A task that is perpetually blocked
 * (conflict unresolved, CI always failing, no CI + stuck) would otherwise re-notify
 * every time the user reads the notification AND every time the 30-min block-retry
 * window resets — combining to send the same notification indefinitely.
 * Checking for ANY notification (read or unread) within this window stops that loop.
 */
const NOTIFY_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface NotifyParams {
  taskId: number;
  type: string;
  title: string;
  message: string;
}

/**
 * Create a task-linked notification unless the same type+task was already
 * notified within the cooldown window.
 *
 * @param p - Notification fields. / 通知内容
 */
export async function notify(p: NotifyParams): Promise<void> {
  const link = `/tasks/${p.taskId}`;
  // NOTE: Check for any recent notification of the same type+link (read OR unread).
  // Checking isRead:false only would restart the cycle every time the user reads
  // the notification. Checking by time window prevents re-notification for at least
  // NOTIFY_COOLDOWN_MS regardless of read status.
  const existing = await prisma.notification
    .findFirst({
      where: {
        type: p.type,
        link,
        createdAt: { gte: new Date(Date.now() - NOTIFY_COOLDOWN_MS) },
      },
    })
    .catch(() => null);
  if (existing) return;
  await prisma.notification
    .create({
      data: {
        type: p.type,
        title: p.title,
        message: p.message,
        link,
        metadata: JSON.stringify({ taskId: p.taskId }),
      },
    })
    .catch(() => {});
}
