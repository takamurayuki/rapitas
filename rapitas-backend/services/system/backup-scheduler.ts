/**
 * Backup Scheduler
 *
 * Lightweight self-contained scheduler that wakes up every CHECK_INTERVAL_MS
 * and triggers a backup when the previous one is older than DUE_AFTER_MS.
 *
 * Designed for desktop / single-process use. Does not coordinate across
 * processes — sufficient for a Tauri app where the backend is a single sidecar.
 */

import { createLogger } from '../../config/logger';
import { runBackup, readBackupStatus } from './backup-service';

const log = createLogger('backup-scheduler');

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DUE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function maybeRunBackup(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const status = readBackupStatus();
    const lastRun = status.lastRunAt?.getTime() ?? 0;
    const now = Date.now();
    if (now - lastRun < DUE_AFTER_MS) {
      log.debug({ hoursSinceLast: Math.round((now - lastRun) / 3600_000) }, 'Backup not due yet');
      return;
    }
    log.info('Backup is due — running');
    const result = await runBackup();
    if (!result.success) {
      log.warn({ error: result.error }, 'Scheduled backup failed');
    }
  } catch (err) {
    log.error({ err }, 'Backup scheduler iteration failed');
  } finally {
    running = false;
  }
}

/** Start the periodic check. Idempotent — calling twice is a no-op. */
export function startBackupScheduler(): void {
  if (timer) return;
  // Don't run on the very first tick — give the server a chance to fully start.
  timer = setInterval(() => {
    void maybeRunBackup();
  }, CHECK_INTERVAL_MS);
  // First check after 5 minutes so a freshly-started process backs up if due.
  setTimeout(
    () => {
      void maybeRunBackup();
    },
    5 * 60 * 1000,
  );
  log.info('Backup scheduler started');
}

/** Stop the scheduler. Used in tests / graceful shutdown. */
export function stopBackupScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
