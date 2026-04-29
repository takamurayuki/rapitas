/**
 * Backup Routes
 *
 * List existing backups, trigger a manual backup, and report the scheduler
 * status. All paths are local filesystem under ~/.rapitas/backups/.
 */
import { Elysia } from 'elysia';
import { createLogger } from '../../config/logger';
import { listBackups, readBackupStatus, runBackup } from '../../services/system/backup-service';

const log = createLogger('routes:backups');

export const backupsRoutes = new Elysia({ prefix: '/system/backups' })
  .get('/', () => {
    const items = listBackups().map((b) => ({
      filename: b.filename,
      sizeBytes: b.sizeBytes,
      createdAt: b.createdAt.toISOString(),
      provider: b.provider,
    }));
    const status = readBackupStatus();
    return {
      backups: items,
      status: {
        lastRunAt: status.lastRunAt?.toISOString() ?? null,
        lastResult: status.lastResult,
        lastFilename: status.lastFilename ?? null,
        lastError: status.lastError ?? null,
      },
    };
  })

  .post('/run', async () => {
    log.info('Manual backup triggered');
    const result = await runBackup();
    return {
      success: result.success,
      record: result.record
        ? {
            filename: result.record.filename,
            sizeBytes: result.record.sizeBytes,
            createdAt: result.record.createdAt.toISOString(),
            provider: result.record.provider,
          }
        : null,
      error: result.error ?? null,
      durationMs: result.durationMs,
    };
  });
