/**
 * MemoReminderScheduler
 *
 * Periodically fires due memo reminders through the Notification pipeline
 * (in-app SSE feed). One-shot: a memo's reminder fires once and is stamped
 * with remindedAt; done memos never fire.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { createNotification } from '../communication/notification-service';

const logger = createLogger('memo-reminder-scheduler');

const CHECK_INTERVAL_MS = 60_000; // 1-minute resolution is plenty for memos
const MESSAGE_MAX_LEN = 120;

let intervalId: NodeJS.Timeout | null = null;

/**
 * Fire notifications for every due, unfired, not-done memo reminder.
 *
 * @param now - Reference time (injectable for tests) / 基準時刻
 * @returns Number of reminders fired / 発火したリマインダー数
 */
export async function fireDueMemoReminders(now: Date = new Date()): Promise<number> {
  const due = await prisma.memo.findMany({
    where: { remindAt: { lte: now }, remindedAt: null, isDone: false },
    orderBy: { remindAt: 'asc' },
  });
  for (const memo of due) {
    // Stamp BEFORE notifying so a notification failure can't double-fire the
    // same memo on the next tick; the guard below un-stamps on failure.
    await prisma.memo.update({ where: { id: memo.id }, data: { remindedAt: now } });
    try {
      const text =
        memo.content.length > MESSAGE_MAX_LEN
          ? `${memo.content.slice(0, MESSAGE_MAX_LEN)}…`
          : memo.content;
      await createNotification({
        type: 'memo_reminder',
        title: 'メモのリマインダー',
        message: text,
        link: '/memos',
        metadata: { memoId: memo.id },
      });
    } catch (error) {
      await prisma.memo.update({ where: { id: memo.id }, data: { remindedAt: null } });
      logger.error({ err: error, memoId: memo.id }, 'Failed to deliver memo reminder');
    }
  }
  return due.length;
}

/**
 * Start the periodic reminder check (idempotent).
 */
export function startMemoReminderScheduler(): void {
  if (intervalId) return;
  intervalId = setInterval(() => {
    fireDueMemoReminders().catch((error) => {
      logger.error({ err: error }, 'Memo reminder tick failed');
    });
  }, CHECK_INTERVAL_MS);
  // Catch up on reminders that came due while the server was down.
  fireDueMemoReminders().catch((error) => {
    logger.error({ err: error }, 'Initial memo reminder sweep failed');
  });
  logger.info('Memo reminder scheduler started');
}

/**
 * Stop the periodic reminder check.
 */
export function stopMemoReminderScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
