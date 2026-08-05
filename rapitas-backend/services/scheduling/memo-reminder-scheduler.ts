/**
 * MemoReminderScheduler
 *
 * Fires due memo reminders through the Notification pipeline (in-app SSE
 * feed). Delivery is second-precise: a one-shot timer is armed for the exact
 * next remindAt (re-armed on every memo create/update/delete via
 * rearmMemoReminders), with a 60s polling sweep kept only as a safety net.
 * One-shot semantics: a reminder fires once and is stamped with remindedAt;
 * done memos never fire.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { createNotification } from '../communication/notification-service';

const logger = createLogger('memo-reminder-scheduler');

const CHECK_INTERVAL_MS = 60_000; // safety-net sweep; precise timer does the real work
const MESSAGE_MAX_LEN = 120;

let intervalId: NodeJS.Timeout | null = null;
let preciseTimer: NodeJS.Timeout | null = null;

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
 * Arm (or re-arm) the precise one-shot timer for the earliest pending
 * reminder. Called after every fire and from the memo CRUD routes, so a
 * reminder set for 15:00 fires AT 15:00, not at the next polling tick.
 * When the earliest reminder is further out than the sweep interval the timer
 * simply re-checks then — self-chaining without an unbounded setTimeout.
 */
export async function rearmMemoReminders(): Promise<void> {
  if (preciseTimer) {
    clearTimeout(preciseTimer);
    preciseTimer = null;
  }
  const next = await prisma.memo.findFirst({
    where: { remindAt: { not: null }, remindedAt: null, isDone: false },
    orderBy: { remindAt: 'asc' },
    select: { remindAt: true },
  });
  if (!next?.remindAt) return;
  const delay = Math.max(0, Math.min(next.remindAt.getTime() - Date.now(), CHECK_INTERVAL_MS));
  preciseTimer = setTimeout(() => {
    preciseTimer = null;
    fireDueMemoReminders()
      .catch((error) => {
        logger.error({ err: error }, 'Precise memo reminder fire failed');
      })
      .finally(() => {
        void rearmMemoReminders();
      });
  }, delay);
}

/**
 * Start the reminder scheduler (idempotent): precise timer + safety sweep.
 */
export function startMemoReminderScheduler(): void {
  if (intervalId) return;
  intervalId = setInterval(() => {
    fireDueMemoReminders()
      .catch((error) => {
        logger.error({ err: error }, 'Memo reminder tick failed');
      })
      .finally(() => {
        void rearmMemoReminders();
      });
  }, CHECK_INTERVAL_MS);
  // Catch up on reminders that came due while the server was down, then arm
  // the precise timer for whatever is next.
  fireDueMemoReminders()
    .catch((error) => {
      logger.error({ err: error }, 'Initial memo reminder sweep failed');
    })
    .finally(() => {
      void rearmMemoReminders();
    });
  logger.info('Memo reminder scheduler started');
}

/**
 * Stop the reminder scheduler.
 */
export function stopMemoReminderScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (preciseTimer) {
    clearTimeout(preciseTimer);
    preciseTimer = null;
  }
}
