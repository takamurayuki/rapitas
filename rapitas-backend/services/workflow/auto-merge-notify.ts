/**
 * auto-merge-notify
 *
 * Deduplicated user notifications for auto-merge outcomes. NOT responsible for
 * deciding outcomes — only for creating the Notification rows with a cooldown.
 */
import { prisma } from '../../config/database';
import { buildNotificationI18n } from '../communication/notification-i18n';

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
        // NOTE: This helper only receives the already-formatted title/message
        // (dynamic values like PR numbers are baked in by the many callers
        // across auto-merge-watcher.ts/auto-merge-ci-failure.ts/etc. — out of
        // this task's scope to touch). The title translates fully (it is
        // always static copy); the message is passed through untranslated via
        // the `message` param — see notification.types.<type>.message in the
        // fragment files, which render `{message}` verbatim in both locales.
        metadata: JSON.stringify({
          taskId: p.taskId,
          i18n: buildNotificationI18n(p.type, { message: p.message }),
        }),
      },
    })
    .catch(() => {});
}
