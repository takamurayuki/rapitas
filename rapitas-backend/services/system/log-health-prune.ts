/**
 * Log Health Prune
 *
 * Deletes rapitas's own daily backend log files past the retention window.
 * Split out of log-health-check.ts to keep that file under the size ratchet; not
 * responsible for reading or analysing logs.
 */
import { readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getBackendLogFilePath } from '../../config/logger';

/** Delete daily backend log files older than this many days. */
const RETENTION_DAYS = 14;

/** Deletes daily backend log files older than the retention window. */
export function pruneOldLogs(): void {
  const dir = join(getBackendLogFilePath(), '..');
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const file of files) {
    const m = file.match(/^backend-(\d{4})-(\d{2})-(\d{2})\.log$/);
    if (!m) continue;
    const fileTime = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    if (fileTime < cutoff) {
      try {
        unlinkSync(join(dir, file));
      } catch {
        /* ignore */
      }
    }
  }
}
